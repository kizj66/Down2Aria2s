import { Plus, ServerInfos, ServerInfo, Trash, aria2Status, aria2TellActive, aria2TellStatus, aria2Pause, aria2ForcePause, aria2Unpause, aria2Remove, aria2ForceRemove, aria2RemoveDownloadResult, Aria2ActiveTask, fmtSize, fmtSpeed, getStorage, setStorage, Pause, Play, Stop } from './util'
import { createAutoAnimate } from '@formkit/auto-animate/solid'

import 'overlayscrollbars/overlayscrollbars.css'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-solid'
import { For, Show, createResource, createSignal, createMemo, onCleanup, onMount } from 'solid-js'
import CreateServer from './CreateServer'

type DownloadItem = {
  serverTitle: string
  task: Aria2ActiveTask
}

const App = () => {
  const [flag, setFlag] = createSignal(false)
  const [activeTab, setActiveTab] = createSignal<'downloads' | 'devices'>('downloads')

  const [parent] = createAutoAnimate()

  const fetcher = async () => {
    const serverInfos: ServerInfos = await getStorage()
    return serverInfos
  }

  const [serverInfos, { refetch }] = createResource(fetcher)

  // 服务器在线状态
  const [serverStatus, setServerStatus] = createSignal<Record<string, boolean>>({})
  // 下载任务列表
  const [downloads, setDownloads] = createSignal<DownloadItem[]>([])
  // 每个任务操作中的状态，key = serverTitle:gid
  const [busy, setBusy] = createSignal<Set<string>>(new Set())
  // 已发起停止但 aria2 还没处理完的 gid，tick 期间要过滤掉这些
  // 防止"乐观删除后又被 tick 拉回来"
  // key = `${serverTitle}|${gid}`，value = 超时清理的 timer id
  const pendingRemovals = new Map<string, number>()

  // Toast 通知（错误反馈）
  const [toast, setToast] = createSignal<{ msg: string; type: 'error' | 'info' } | null>(null)
  const showToast = (msg: string, type: 'error' | 'info' = 'error') => {
    setToast({ msg, type })
    window.setTimeout(() => setToast(null), 3000)
  }

  const i18n = (key: string, fallback: string) => {
    try {
      const msg = chrome.i18n.getMessage(key)
      return msg && msg !== '' ? msg : fallback
    } catch {
      return fallback
    }
  }

  const appName = () => i18n('appName', 'Down2Aria2s')

  // ========== WebSocket 实时刷新 ==========
  // aria2 支持 JSON-RPC over WebSocket：发送 RPC 请求，aria2 响应数据。
  // 这样既避免 HTTP 轮询，又能拿到实时进度。
  const wsMap = new Map<string, WebSocket>()
  const wsReadyMap = new Map<string, boolean>() // ws 是否已 open
  const pollTimers = new Map<string, number>() // 每个服务器一个 poll 定时器

  const toWsUrl = (httpUrl: string): string => {
    return httpUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
  }

  const setServerOnline = (title: string, online: boolean) => {
    setServerStatus(prev => ({ ...prev, [title]: online }))
  }

  // 把 gid 加入"已停止"集合，5 秒内 tick 拉取时跳过它，防止回弹
  const markPendingRemoval = (serverTitle: string, gid: string) => {
    const key = `${serverTitle}|${gid}`
    if (pendingRemovals.has(key)) return
    const timer = window.setTimeout(() => pendingRemovals.delete(key), 5000)
    pendingRemovals.set(key, timer)
  }

  const isPendingRemoval = (serverTitle: string, gid: string) => {
    return pendingRemovals.has(`${serverTitle}|${gid}`)
  }

  // 通过 WebSocket 发送 JSON-RPC 请求
  const sendWsRpc = (ws: WebSocket, method: string, params: any[]): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('ws not open'))
        return
      }
      const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const handler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          if (data.id === id) {
            ws.removeEventListener('message', handler)
            if (data.error) reject(new Error(data.error.message))
            else resolve(data.result)
          }
        } catch {
          // ignore
        }
      }
      ws.addEventListener('message', handler)
      ws.send(JSON.stringify({ id, jsonrpc: '2.0', method, params }))
      // 5 秒超时
      setTimeout(() => {
        ws.removeEventListener('message', handler)
        reject(new Error('timeout'))
      }, 5000)
    })
  }

  // 通过 WebSocket 拉取一台服务器的活跃下载（错误向上抛）
  const fetchActiveViaWs = async (ws: WebSocket, title: string): Promise<DownloadItem[]> => {
    const result = await sendWsRpc(ws, 'aria2.tellActive', [
      ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files'],
    ])
    if (!Array.isArray(result)) return []
    return result.map((task: any) => ({ serverTitle: title, task }))
  }

  // 统一拉取一台服务器的活跃下载：WS 优先，否则 HTTP 兜底
  // 顺便根据探测结果更新设备在线状态（这是最权威的判断标准）
  // 解决 NAS 等不开放 WebSocket 的 aria2 服务端无法监控的问题
  const fetchActive = async (title: string): Promise<DownloadItem[]> => {
    const servers = serverInfos() || []
    const server = servers.find(s => s.title === title)
    if (!server) return []

    const ws = wsMap.get(title)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const items = await fetchActiveViaWs(ws, title)
        // WS 拉取成功 → 在线（无论有没有任务）
        setServerOnline(title, true)
        return items
      } catch {
        // WS 拉取失败，继续尝试 HTTP
      }
    }

    // WS 不可用 / 失败时回退到 HTTP
    try {
      const tasks = await aria2TellActive(server.url, server.token)
      // HTTP 拉取成功 → 在线
      setServerOnline(title, true)
      return tasks.map(task => ({ serverTitle: title, task }))
    } catch {
      // HTTP 也失败 → 离线
      setServerOnline(title, false)
      return []
    }
  }

  // 通过 WebSocket 检查服务器在线
  const checkOnlineViaWs = async (ws: WebSocket): Promise<boolean> => {
    try {
      await sendWsRpc(ws, 'aria2.getGlobalStat', [])
      return true
    } catch {
      return false
    }
  }

  // 整体刷新下载列表（对所有配置的服务器拉取，WS 优先 HTTP 兜底）
  const refreshDownloads = async () => {
    const servers = serverInfos() || []
    const allDownloads: DownloadItem[] = []
    await Promise.all(
      servers.map(async s => {
        const items = await fetchActive(s.title)
        allDownloads.push(...items)
      }),
    )
    setDownloads(allDownloads)
  }

  // 完整刷新：检测在线状态 + 拉取下载列表
  const fullRefresh = async () => {
    const servers = serverInfos()
    if (!servers || servers.length === 0) {
      setDownloads([])
      return
    }

    // 用 HTTP 兜底检查在线状态（兼容 WS 还未建立的情况）
    const statusMap: Record<string, boolean> = { ...serverStatus() }
    await Promise.all(
      servers.map(async s => {
        if (wsReadyMap.get(s.title)) {
          // WS 已连接：跳过 HTTP 检查
          statusMap[s.title] = true
          return
        }
        try {
          statusMap[s.title] = await aria2Status(s.url, s.token)
        } catch {
          statusMap[s.title] = false
        }
      }),
    )
    setServerStatus(statusMap)

    await refreshDownloads()
  }

  // 启动单台服务器的实时轮询（每秒 tellActive，WS 优先 HTTP 兜底）
  const startRealtimePolling = (title: string) => {
    stopRealtimePolling(title)
    const tick = async () => {
      // 如果服务器配置已被删除，停止轮询
      const servers = serverInfos() || []
      if (!servers.find(s => s.title === title)) {
        stopRealtimePolling(title)
        return
      }
      const items = await fetchActive(title)
      // 过滤掉"已停止但 aria2 还没处理完"的任务（防止回弹）
      const filtered = items.filter(it => !isPendingRemoval(title, it.task.gid))
      // 增量更新：替换这台服务器的所有任务
      setDownloads(prev => {
        const others = prev.filter(d => d.serverTitle !== title)
        // 保留已有 downloadItem 引用（让 <For> 按引用 key 复用 DOM）
        const prevMap = new Map<string, DownloadItem>()
        prev.forEach(d => {
          if (d.serverTitle === title) prevMap.set(d.task.gid, d)
        })
        const merged: DownloadItem[] = filtered.map(newItem => {
          const existing = prevMap.get(newItem.task.gid)
          // 同 gid：复用外层对象，task 用新对象让 SolidJS 检测到属性变化
          return existing
            ? { serverTitle: title, task: { ...existing.task, ...newItem.task } }
            : newItem
        })
        return [...others, ...merged]
      })
    }
    // 立即拉一次，然后每秒一次
    tick()
    const timer = window.setInterval(tick, 1000)
    pollTimers.set(title, timer)
  }

  const stopRealtimePolling = (title: string) => {
    const timer = pollTimers.get(title)
    if (timer !== undefined) {
      clearInterval(timer)
      pollTimers.delete(title)
    }
  }

  const stopAllPolling = () => {
    pollTimers.forEach((_t, title) => stopRealtimePolling(title))
  }

  // 连接所有服务器的 WebSocket
  const connectWebSockets = () => {
    const servers = serverInfos()
    if (!servers) return

    disconnectWebSockets()

    servers.forEach(s => {
      // 立即为每台服务器启动轮询（fetchActive 内部 WS 优先 / HTTP 兜底）
      // 这样 WS 没建上（NAS 等不支持 WS 的 aria2）也能正常监控
      startRealtimePolling(s.title)

      const wsUrl = toWsUrl(s.url)
      try {
        const ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          wsReadyMap.set(s.title, true)
          setServerOnline(s.title, true)
          // WS 建上后重启轮询，让 fetchActive 切到 WS 路径
          startRealtimePolling(s.title)
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            // aria2 推送的事件：aria2.onXXX
            if (data.method && data.method.startsWith('aria2.on')) {
              // 事件触发时立即拉一次最新数据（用统一 fetchActive，WS/HTTP 自适应）
              fetchActive(s.title).then(items => {
                setDownloads(prev => {
                  const others = prev.filter(d => d.serverTitle !== s.title)
                  return [...others, ...items]
                })
              })
            }
          } catch {
            // ignore
          }
        }

        ws.onclose = () => {
          wsMap.delete(s.title)
          wsReadyMap.delete(s.title)
          // 注意：不要在这里 setServerOnline(false)！
          // NAS 等设备不支持 WS 会立即 onclose，但 HTTP 路径完全正常，
          // 在线状态由 fetchActive 的探测结果决定（见 fetchActive 内）
        }

        ws.onerror = () => {
          // onclose 会跟随
        }

        wsMap.set(s.title, ws)
      } catch {
        // WS 创建失败，HTTP 轮询已在前面启动
      }
    })
  }

  const disconnectWebSockets = () => {
    stopAllPolling()
    wsMap.forEach(ws => {
      try {
        ws.close()
      } catch {
        // ignore
      }
    })
    wsMap.clear()
    wsReadyMap.clear()
  }

  onMount(() => {
    // 1. 立即 HTTP 查一次状态（兼容性兜底）
    fullRefresh()
    // 2. 建立 WebSocket（实时 tellActive）
    connectWebSockets()
  })

  onCleanup(() => {
    disconnectWebSockets()
  })

  // 当 serverInfos 变化时（添加/删除设备）重新加载和连接
  let prevServers: ServerInfos | undefined
  createMemo(() => {
    const s = serverInfos()
    if (s !== prevServers) {
      prevServers = s
      if (s) {
        fullRefresh()
        connectWebSockets()
      }
    }
  })

  const deleteServer = async (title: string) => {
    const newServerInfo = serverInfos()?.filter(v => v.title !== title)
    await setStorage(newServerInfo)
    refetch()
  }

  const onBack = (flag: boolean) => {
    refetch()
    setFlag(flag)
  }

  // 任务操作
  const busyKey = (serverTitle: string, gid: string) => `${serverTitle}:${gid}`
  const isBusy = (serverTitle: string, gid: string) => busy().has(busyKey(serverTitle, gid))
  const setTaskBusy = (serverTitle: string, gid: string, value: boolean) => {
    const next = new Set(busy())
    const k = busyKey(serverTitle, gid)
    if (value) next.add(k)
    else next.delete(k)
    setBusy(next)
  }

  const findServer = (serverTitle: string) => serverInfos()?.find(s => s.title === serverTitle)

  // 通过 WebSocket 调用 RPC（WS 与 HTTP 都带上 token，避免 WS 因缺 token 被拒）
  const wsCall = async (title: string, method: string, params: any[]): Promise<boolean> => {
    const server = findServer(title)
    const token = server?.token && server.token !== '' ? server.token : ''
    const fullParams = token ? [`token:${token}`, ...params] : params

    // 1) 优先走 WebSocket
    const ws = wsMap.get(title)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        await sendWsRpc(ws, method, fullParams)
        return true
      } catch (e) {
        console.warn(`[Down2Aria2s] WS ${method} 失败，回退 HTTP:`, e)
        // fall through to HTTP
      }
    }

    // 2) 兜底走 HTTP
    if (!server) return false
    const gid = params.find((p: any) => typeof p === 'string' && /^[0-9a-f]+$/.test(p))
    try {
      if (method === 'aria2.pause') {
        await aria2Pause(server.url, gid, server.token)
      } else if (method === 'aria2.forcePause') {
        await aria2ForcePause(server.url, gid, server.token)
      } else if (method === 'aria2.unpause') {
        await aria2Unpause(server.url, gid, server.token)
      } else if (method === 'aria2.remove') {
        await aria2Remove(server.url, gid, server.token)
      } else if (method === 'aria2.forceRemove') {
        await aria2ForceRemove(server.url, gid, server.token)
      } else if (method === 'aria2.removeDownloadResult') {
        await aria2RemoveDownloadResult(server.url, gid, server.token)
      } else if (method === 'aria2.tellStatus') {
        await aria2TellStatus(server.url, gid, server.token)
      }
      return true
    } catch (e) {
      console.error(`[Down2Aria2s] HTTP ${method} 失败:`, e)
      return false
    }
  }

  // 确认某 gid 在 aria2 的活跃列表里是否还存在（用于验证"停止"是否真的生效）
  // 用 fetchActive（WS 优先/HTTP 兜底），与监控同一通道，NAS 等无 HTTP 的服务器也能正确判断
  const isTaskStillActive = async (title: string, gid: string): Promise<boolean> => {
    try {
      const items = await fetchActive(title)
      return items.some(it => it.task.gid === gid)
    } catch {
      return true // 查不到就保守认为还在
    }
  }

  // 乐观更新单条任务的字段（不等服务器往返）
  const patchTask = (serverTitle: string, gid: string, patch: Partial<Aria2ActiveTask>) => {
    setDownloads(prev =>
      prev.map(d =>
        d.serverTitle === serverTitle && d.task.gid === gid
          ? { ...d, task: { ...d.task, ...patch } }
          : d,
      ),
    )
  }

  const handlePause = async (item: DownloadItem) => {
    // 乐观更新：立即把状态改为 paused，UI 马上反馈
    patchTask(item.serverTitle, item.task.gid, { status: 'paused', downloadSpeed: 0 })
    setTaskBusy(item.serverTitle, item.task.gid, true)
    try {
      // 用 forcePause 而非 pause——pause 会被"下载发起方"阻塞，forcePause 不会
      const ok = await wsCall(item.serverTitle, 'aria2.forcePause', [item.task.gid])
      if (!ok) {
        // forcePause 失败时回退到普通 pause
        await wsCall(item.serverTitle, 'aria2.pause', [item.task.gid])
      }
    } catch {
      // 操作失败，下一次 polling tick 会用服务器真实状态覆盖本地
    } finally {
      setTaskBusy(item.serverTitle, item.task.gid, false)
    }
  }

  const handleResume = async (item: DownloadItem) => {
    // 乐观更新：立即把状态改为 waiting
    patchTask(item.serverTitle, item.task.gid, { status: 'waiting' })
    setTaskBusy(item.serverTitle, item.task.gid, true)
    try {
      await wsCall(item.serverTitle, 'aria2.unpause', [item.task.gid])
    } finally {
      setTaskBusy(item.serverTitle, item.task.gid, false)
    }
  }

  const handleRemove = async (item: DownloadItem) => {
    const key = `${item.serverTitle}|${item.task.gid}`
    // 乐观更新：标记 pendingRemoval 并立即从列表移除
    markPendingRemoval(item.serverTitle, item.task.gid)
    setDownloads(prev => prev.filter(d => !(d.serverTitle === item.serverTitle && d.task.gid === item.task.gid)))
    setTaskBusy(item.serverTitle, item.task.gid, true)

    const fileName = item.task.files?.[0]?.path?.split('/').pop() || '任务'
    let lastErr = ''

    // 删除失败时：取消 pendingRemoval，让任务重新出现在 UI 上（下次 tick 也会补回）
    const revertToServer = async () => {
      const timer = pendingRemovals.get(key)
      if (timer) {
        window.clearTimeout(timer)
        pendingRemovals.delete(key)
      }
      const items = await fetchActive(item.serverTitle)
      setDownloads(prev => {
        const others = prev.filter(d => !(d.serverTitle === item.serverTitle && d.task.gid === item.task.gid))
        return [...others, ...items]
      })
    }

    try {
      // 1) 先 forceRemove（active 状态也能直接删并停止下载）
      let ok = await wsCall(item.serverTitle, 'aria2.forceRemove', [item.task.gid])

      // 2) forceRemove 失败，回退 forcePause → 等 → remove
      if (!ok) {
        console.warn('[Down2Aria2s] forceRemove 失败，回退 forcePause → remove')
        try { await wsCall(item.serverTitle, 'aria2.forcePause', [item.task.gid]) } catch {}
        await new Promise(r => setTimeout(r, 300)) // 给 aria2 处理暂停
        ok = await wsCall(item.serverTitle, 'aria2.remove', [item.task.gid])
      }

      // 3) 真正去 aria2 确认这条任务是不是没了（避免"假装成功、后台还在下"）
      const stillThere = await isTaskStillActive(item.serverTitle, item.task.gid)
      if (stillThere) {
        await revertToServer()
        showToast(`删除失败：${fileName}（aria2 仍在下载，请检查 ${item.serverTitle} 的 token/URL）`, 'error')
      } else {
        showToast(`已删除：${fileName}`, 'info')
      }
    } catch (e: any) {
      lastErr = e?.message || String(e)
      await revertToServer()
      showToast(`删除失败：${fileName}（${lastErr}）`, 'error')
    } finally {
      setTaskBusy(item.serverTitle, item.task.gid, false)
    }
  }

  // 手动刷新
  const handleManualRefresh = () => {
    fullRefresh()
  }

  // 在线设备数量
  const onlineCount = createMemo(() => {
    const sm = serverStatus()
    return Object.values(sm).filter(v => v).length
  })

  // ========== 按设备分组（按 serverInfos 配置顺序稳定） ==========
  const deviceGroups = createMemo(() => {
    const servers = serverInfos() || []
    const groups: Array<[string, DownloadItem[]]> = servers
      .filter(s => downloads().some(d => d.serverTitle === s.title))
      .map(s => [s.title, [] as DownloadItem[]])
    const groupMap: Record<string, DownloadItem[]> = {}
    groups.forEach(([title, items]) => { groupMap[title] = items })
    downloads().forEach(item => {
      if (groupMap[item.serverTitle]) {
        groupMap[item.serverTitle].push(item)
      } else {
        // 兜底：未配置的服务器（理论不应发生），追加到末尾
        groups.push([item.serverTitle, [item]])
      }
    })
    return groups
  })

  const onPause = (item: DownloadItem) => handlePause(item)
  const onResume = (item: DownloadItem) => handleResume(item)
  const onRemove = (item: DownloadItem) => handleRemove(item)

  return (
    <div ref={parent} class="flex h-full w-full flex-col gap-1.5 rounded-lg bg-app-bg p-2 text-app-primary">
      <Show when={!flag()} fallback={<CreateServer onBack={onBack} />}>
        {/* 标签页 */}
        <div class="flex shrink-0 gap-1 rounded-lg bg-app-card p-1">
          <button
            onClick={() => setActiveTab('downloads')}
            class={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors ${
              activeTab() === 'downloads' ? 'bg-primary text-white' : 'text-app-secondary hover:text-app-primary'
            }`}
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {i18n('downloads', '下载任务')}
          </button>
          <button
            onClick={() => setActiveTab('devices')}
            class={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors ${
              activeTab() === 'devices' ? 'bg-primary text-white' : 'text-app-secondary hover:text-app-primary'
            }`}
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7M9 21V9h6v12" />
            </svg>
            {i18n('devices', '设备管理')}
          </button>
        </div>

        {/* 标签内容 */}
        <Show when={activeTab() === 'downloads'}>
          <div class="flex h-full min-h-0 flex-col">
            {/* 状态栏 + 手动刷新按钮 */}
            <div class="flex shrink-0 items-center justify-between px-1 py-0.5 text-[11px] text-app-muted">
              <span>{downloads().length} 个任务</span>
              <button
                onClick={handleManualRefresh}
                title="刷新"
                class="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-primary/15 hover:text-primary"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>

            <OverlayScrollbarsComponent
              defer
              element="span"
              options={{ scrollbars: { autoHide: 'scroll', theme: 'os-theme-light' } }}
              class="flex-1 overflow-y-auto"
            >
              <Show
                when={downloads().length > 0}
                fallback={
                  <div class="flex h-full flex-col items-center justify-center py-10 text-center">
                    <svg class="mb-2 h-10 w-10 text-app-muted opacity-50" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c0-.621.504-1.125 1.125-1.125z" />
                    </svg>
                    <p class="text-xs text-app-muted">{i18n('noActiveDownloads', '暂无活跃下载任务')}</p>
                  </div>
                }
              >
                <div class="flex flex-col gap-2 p-0.5">
                  <For each={deviceGroups()}>
                    {([deviceTitle, items]) => {
                      const isOnline = () => serverStatus()[deviceTitle] === true
                      const totalSpeed = () => items.reduce((sum, item) => sum + (parseInt(String(item.task.downloadSpeed)) || 0), 0)
                      return (
                        <div class="rounded-lg border border-app-border bg-app-card/40 overflow-hidden">
                          {/* 设备分组头部 */}
                          <div class="flex items-center gap-2 border-b border-app-border/60 bg-app-card/60 px-2.5 py-1.5">
                            <span class={`h-2 w-2 shrink-0 rounded-full ${isOnline() ? 'bg-success' : 'bg-muted'}`} />
                            <span class="truncate text-xs font-semibold text-app-primary">{deviceTitle}</span>
                            <span class="ml-auto shrink-0 text-[10px] text-app-muted">{items.length} 个任务 · {fmtSpeed(totalSpeed())}</span>
                          </div>
                          {/* 任务列表 - 按 gid 稳定排序，防止 tick 期间位置错乱 */}
                          <div class="flex flex-col gap-1.5 p-1.5">
                            <For each={[...items].sort((a, b) => a.task.gid.localeCompare(b.task.gid))}>
                              {(item) => {
                                const progress = () => {
                                  const total = parseInt(String(item.task.totalLength)) || 0
                                  const completed = parseInt(String(item.task.completedLength)) || 0
                                  return total > 0 ? Math.min((completed / total) * 100, 100) : 0
                                }
                                const fileName = () => {
                                  const filePath = item.task.files?.[0]?.path || ''
                                  if (!filePath) return 'Unknown'
                                  const parts = filePath.replace(/\\/g, '/').split('/')
                                  return parts[parts.length - 1] || 'Unknown'
                                }
                                const isPaused = () => item.task.status === 'paused'
                                const busyNow = () => isBusy(item.serverTitle, item.task.gid)
                                const speed = () => fmtSpeed(parseInt(String(item.task.downloadSpeed)) || 0)
                                const sizeInfo = () => {
                                  const total = parseInt(String(item.task.totalLength)) || 0
                                  const completed = parseInt(String(item.task.completedLength)) || 0
                                  return `${fmtSize(completed)} / ${fmtSize(total)}`
                                }

                                return (
                                  <div class="rounded-md border border-app-border/30 bg-app-card/40 px-2 py-1.5">
                                    <div class="mb-1 flex items-center justify-between gap-2">
                                      <span class="truncate text-[11px] font-medium text-app-primary">{fileName()}</span>
                                      <span class="shrink-0 text-[10px] text-app-muted">{progress().toFixed(1)}%</span>
                                    </div>
                                    <div class="mb-1 h-1.5 overflow-hidden rounded-full bg-app-bg">
                                      <div
                                        class={`h-full rounded-full transition-all duration-300 ${
                                          isPaused() || busyNow() ? 'bg-warning' : 'bg-gradient-to-r from-primary to-accent'
                                        }`}
                                        style={`width: ${progress()}%`}
                                      />
                                    </div>
                                    <div class="flex items-center justify-between text-[10px] text-app-muted">
                                      <span class="truncate">{sizeInfo()} · {speed()}</span>
                                      <div class="flex shrink-0 items-center gap-0.5">
                                        <Show
                                          when={!isPaused()}
                                          fallback={
                                            <button
                                              onClick={() => onResume(item)}
                                              disabled={busyNow()}
                                              title="继续"
                                              class="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-success/15 hover:text-success disabled:opacity-40"
                                            >
                                              <Play class="text-[10px]" />
                                            </button>
                                          }
                                        >
                                          <button
                                            onClick={() => onPause(item)}
                                            disabled={busyNow()}
                                            title="暂停"
                                            class="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-primary/15 hover:text-primary disabled:opacity-40"
                                          >
                                            <Pause class="text-[10px]" />
                                          </button>
                                        </Show>
                                        <button
                                          onClick={() => onRemove(item)}
                                          disabled={busyNow()}
                                          title="停止"
                                          class="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-error/15 hover:text-error disabled:opacity-40"
                                        >
                                          <Stop class="text-[9px]" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )
                              }}
                            </For>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </OverlayScrollbarsComponent>
          </div>
        </Show>

        <Show when={activeTab() === 'devices'}>
          <div class="flex h-full min-h-0 flex-col">
            {/* 添加设备按钮 */}
            <div class="mb-1.5 flex shrink-0 items-center justify-between px-1">
              <span class="text-[11px] text-app-muted">{onlineCount()} / {serverInfos()?.length || 0} 在线</span>
              <button
                onClick={() => setFlag(!flag())}
                class="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-primary-dark"
              >
                <Plus class="text-xs" />
                {i18n('addDevice', '添加设备')}
              </button>
            </div>

            <OverlayScrollbarsComponent
              defer
              element="span"
              options={{ scrollbars: { autoHide: 'scroll', theme: 'os-theme-light' } }}
              class="flex-1 overflow-y-auto"
            >
              <Show
                when={serverInfos() && serverInfos()!.length > 0}
                fallback={
                  <div class="flex h-full flex-col items-center justify-center py-10 text-center">
                    <svg class="mb-2 h-10 w-10 text-app-muted opacity-50" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7M9 21V9h6v12" />
                    </svg>
                    <p class="text-xs text-app-muted">{i18n('noServers', '尚未配置任何设备')}</p>
                  </div>
                }
              >
                <div class="flex flex-col gap-1.5 p-0.5">
                  <For each={serverInfos()}>
                    {(item: ServerInfo) => {
                      const isOnline = () => serverStatus()[item.title] === true
                      return (
                        <div class="flex items-center gap-2 rounded-lg border border-app-border bg-app-card p-2 transition-colors hover:border-app-card-hover">
                          <span class={`h-2 w-2 shrink-0 rounded-full ${isOnline() ? 'bg-success' : 'bg-muted'}`} />
                          <div class="min-w-0 flex-1">
                            <p class="truncate text-xs font-medium text-app-primary">{item.title}</p>
                            <p class="truncate text-[10px] text-app-muted">{item.url}</p>
                          </div>
                          <span class={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${isOnline() ? 'bg-success/15 text-success' : 'bg-muted/15 text-app-muted'}`}>
                            {isOnline() ? i18n('online', '在线') : i18n('offline', '离线')}
                          </span>
                          <button
                            onClick={() => deleteServer(item.title)}
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-app-muted transition-colors hover:bg-error/10 hover:text-error"
                          >
                            <Trash class="text-xs" />
                          </button>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </OverlayScrollbarsComponent>
          </div>
        </Show>
      </Show>

      {/* Toast 通知（操作反馈） */}
      <Show when={toast()}>
        {(t) => (
          <div
            class="pointer-events-none fixed bottom-2 left-1/2 z-50 -translate-x-1/2 animate-fade-in-up"
            style={{ animation: 'fadeInUp 0.2s ease-out' }}
          >
            <div
              class={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs shadow-lg backdrop-blur-md ${
                t().type === 'error'
                  ? 'border border-error/40 bg-error/15 text-error'
                  : 'border border-success/40 bg-success/15 text-success'
              }`}
            >
              <Show when={t().type === 'error'}>
                <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </Show>
              <Show when={t().type === 'info'}>
                <svg class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </Show>
              <span class="max-w-[280px] truncate">{t().msg}</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

export default App
