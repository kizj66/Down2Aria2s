import { For, render } from 'solid-js/web'
import { FileIcon, ServerInfo, ServerInfos, aria2Add, aria2Status, fmtSize, getStorage } from '../src/util'
import '../src/index.css'
import { Show, Suspense, createEffect, createMemo, createResource, createSelector, createSignal } from 'solid-js'

type Info = {
  fileName: string
  url: string
  fileSize: number
  referrer: string
  storeId: string
}

type ServerState = 'checking' | 'online' | 'offline'

const Confirm = () => {
  const fetcher = async () => {
    const serverInfos: ServerInfos = await getStorage()
    return serverInfos || []
  }
  const [serverInfos] = createResource(fetcher)

  const query = new URLSearchParams(window.location.search)
  const info: Info = JSON.parse(query.get('info') || '')

  const ext = info.fileName.includes('.') ? info.fileName.substring(info.fileName.lastIndexOf('.') + 1) : ''

  const [finalName, setFinalName] = createSignal(info.fileName)

  const [sendError, setSendError] = createSignal<string[]>([])

  const isSendError = createSelector<string[], string>(sendError, (str, data) =>
    data.some(v => v === str),
  )

  // ---- 服务器在线状态检测 ----
  const [statusMap, setStatusMap] = createSignal<Record<string, ServerState>>({})

  const checkAllServers = async (servers: ServerInfos) => {
    if (!servers || servers.length === 0) return
    const init: Record<string, ServerState> = {}
    servers.forEach(s => { init[s.title] = 'checking' })
    setStatusMap(init)
    const results = await Promise.all(
      servers.map(async s => {
        try {
          const ok = await aria2Status(s.url, s.token)
          return { title: s.title, state: (ok ? 'online' : 'offline') as ServerState }
        } catch {
          return { title: s.title, state: 'offline' as ServerState }
        }
      }),
    )
    const next = { ...statusMap() }
    results.forEach(r => { next[r.title] = r.state })
    setStatusMap(next)
  }

  const sortedServers = createMemo(() => {
    const servers = serverInfos() || []
    const sm = statusMap()
    const order: Record<ServerState, number> = { online: 0, checking: 1, offline: 2 }
    return [...servers].sort((a, b) => {
      const sa = sm[a.title] || 'checking'
      const sb = sm[b.title] || 'checking'
      return order[sa] - order[sb]
    })
  })

  createEffect(() => {
    const servers = serverInfos()
    if (servers && servers.length > 0) {
      checkAllServers(servers)
    }
  })

  // 服务器列表稳定后通知 background 调整弹窗高度
  createEffect(() => {
    const servers = sortedServers()
    if (servers && servers.length >= 0) {
      try {
        chrome.runtime.sendMessage(
          { type: 'resizeConfirm', serverCount: servers.length },
          () => { void chrome.runtime.lastError },
        )
      } catch {
        // ignore
      }
    }
  })

  const getCookie = async (url: string, storeId: string) => {
    let cookies: chrome.cookies.Cookie[] = []
    try {
      cookies = await chrome.cookies.getAll({ url, storeId })
    } catch (error) {
      cookies = []
    }
    return cookies.reduce((pre, cur, index) => {
      pre += cur.name + '=' + cur.value + (index === cookies.length - 1 ? '' : ';')
      return pre
    }, '')
  }

  const handleClick = async (item: ServerInfo) => {
    const state = statusMap()[item.title]
    if (state === 'offline') return
    const cookie = await getCookie(info.referrer, info.storeId)
    try {
      await aria2Add(item.url, {
        url: info.url,
        name: finalName(),
        token: item.token,
        referrer: info.referrer,
        cookie,
      })
      try {
        chrome.runtime.sendMessage({ type: 'closeConfirm' }, () => { void chrome.runtime.lastError })
      } catch {
        window.close()
      }
    } catch {
      const errorData = [...sendError()]
      errorData.push(item.title)
      setSendError(errorData)
    }
  }

  const handleBrowserDownload = () => {
    try {
      chrome.runtime.sendMessage(
        {
          type: 'browserBuiltInDownload',
          url: info.url,
          filename: finalName(),
          referrer: info.referrer,
        },
        () => {
          void chrome.runtime.lastError
          try {
            chrome.runtime.sendMessage({ type: 'closeConfirm' }, () => { void chrome.runtime.lastError })
          } catch {
            window.close()
          }
        },
      )
    } catch {
      window.close()
    }
  }

  const i18n = (key: string, fallback: string) => {
    try {
      const msg = chrome.i18n.getMessage(key)
      return msg && msg !== '' ? msg : fallback
    } catch {
      return fallback
    }
  }

  const dotColor = (title: string) => {
    const state = statusMap()[title]
    if (state === 'online') return 'bg-success'
    if (state === 'offline') return 'bg-muted'
    return 'bg-warning'
  }

  const stateLabel = (title: string) => {
    const state = statusMap()[title]
    if (state === 'online') return i18n('online', '在线')
    if (state === 'offline') return i18n('offline', '离线')
    return i18n('checking', '检测中')
  }

  return (
    <div class="flex h-screen w-screen flex-col bg-app-bg text-app-primary">
      {/* 文件信息区：[图标+大小块] + 文件名（同一行） */}
      <div class="flex shrink-0 items-center gap-2 px-3 py-2">
        <Show
          when={info.fileSize > 0}
          fallback={
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-app-card text-accent">
              <FileIcon ext={ext} class="text-lg" />
            </div>
          }
        >
          <div class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-app-card pl-2 pr-2.5 text-accent">
            <FileIcon ext={ext} class="text-base" />
            <span class="whitespace-nowrap text-[11px] text-app-secondary">{fmtSize(info.fileSize)}</span>
          </div>
        </Show>
        <input
          onChange={e => setFinalName(e.target.value)}
          class="min-w-0 flex-1 rounded-md border border-app-border bg-app-card px-2.5 py-1.5 text-xs text-app-primary outline-none transition-colors placeholder:text-app-muted focus:border-primary"
          value={info.fileName}
          placeholder="FileName..."
        />
      </div>

      {/* 设备选择区 */}
      <div class="flex-1 overflow-y-auto px-3 pb-2">
        <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-app-muted">{i18n('selectDevice', '选择下载设备')}</p>
        <Suspense fallback={<p class="text-xs text-app-muted">Loading...</p>}>
          <Show when={sortedServers().length > 0} fallback={
            <div class="flex flex-col items-center justify-center py-6 text-center">
              <p class="text-xs text-app-muted">{i18n('noServers', '尚未配置任何设备')}</p>
            </div>
          }>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={sortedServers()}>
                {item => {
                  const state = () => statusMap()[item.title] || 'checking'
                  const isOffline = () => state() === 'offline'
                  return (
                    <div
                      onClick={() => !isOffline() && handleClick(item)}
                      class={`group flex cursor-pointer flex-col gap-0.5 rounded-md border p-2 transition-all duration-150 ${
                        isOffline()
                          ? 'cursor-not-allowed border-app-border bg-app-card opacity-50'
                          : isSendError(item.title)
                            ? 'border-error bg-app-card'
                            : 'border-app-border bg-app-card hover:border-primary hover:bg-app-card-hover'
                      }`}
                    >
                      <div class="flex items-center gap-1.5">
                        <span
                          class={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor(item.title)} ${state() === 'checking' ? 'animate-pulse' : ''}`}
                        />
                        <span class="truncate text-xs font-semibold">{item.title}</span>
                      </div>
                      <span class="text-[10px] text-app-muted">{stateLabel(item.title)}</span>
                      <Show when={isSendError(item.title)}>
                        <span class="text-[10px] text-error">发送失败</span>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </Suspense>
      </div>

      {/* 底部浏览器下载：紧凑小按钮 */}
      <div class="shrink-0 border-t border-app-border px-3 py-2">
        <button
          onClick={handleBrowserDownload}
          class="w-full cursor-pointer rounded-md border border-app-border bg-app-card py-1.5 text-center text-[11px] text-app-secondary transition-colors hover:border-accent hover:text-accent"
        >
          {i18n('browserBuiltInDownload', '使用浏览器自带下载')}
        </button>
      </div>
    </div>
  )
}

const root = document.getElementById('confirm')

render(() => <Confirm />, root!)
