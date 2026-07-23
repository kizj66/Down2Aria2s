// 标记下一次触发的下载是否直接走浏览器自带下载，跳过弹窗
let skipNextCapture = false

const captureDownload = async (item: chrome.downloads.DownloadItem, suggest: () => void) => {
  // 用户在 confirm 弹窗中点击了"使用浏览器自带下载"时，
  // 会通过 chrome.downloads.download 重新触发一次下载。
  // 此时直接放行，不再弹出 confirm 弹窗。
  if (skipNextCapture) {
    skipNextCapture = false
    suggest()
    return
  }

  suggest()
  const url = item.finalUrl || item.url
  if (!/^(https?|s?ftp)/i.test(url) || url === 'about:blank') return
  await chrome.downloads.cancel(item.id)

  // 预估高度：4 台设备 + 标签，足够常见场景。confirm 页面加载后会再发消息按实际服务器数量 resize
  const width = 380
  const initHeight = 300

  chrome.windows.getCurrent((current: chrome.windows.Window) => {
    const left = Math.round((current.width! - width) * 0.5 + current.left!)
    const top = Math.round((current.height! - initHeight) * 0.5 + current.top!)
    chrome.windows.create({
      url: `confirm/index.html?info=${encodeURIComponent(
        JSON.stringify({
          fileName: item.filename || 'download',
          url,
          fileSize: item.fileSize,
          referrer: item.referrer || '',
          storeId: item.incognito === true ? '1' : '0',
        }),
      )}`,
      type: 'popup',
      width,
      height: initHeight,
      left,
      top,
    }, (win) => {
      if (win && win.id !== undefined) {
        // 缓存 confirm 弹窗 id，用于后续 resize
        confirmWindowId = win.id
      }
    })
  })
}

let confirmWindowId: number | undefined

chrome.downloads.onDeterminingFilename.addListener(captureDownload)

// 接收来自 confirm 弹窗的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'browserBuiltInDownload') {
    // 先设置标志，再触发下载，确保下一次 onDeterminingFilename 触发时能识别
    skipNextCapture = true
    chrome.downloads.download(
      {
        url: message.url,
        filename: message.filename,
        conflictAction: 'uniquify',
      },
      downloadId => {
        // 如果下载启动失败（例如 URL 失效、被拦截等），清掉标志避免影响后续
        if (chrome.runtime.lastError || downloadId === undefined) {
          skipNextCapture = false
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message })
        } else {
          sendResponse({ ok: true, downloadId })
        }
      },
    )
    return true
  }

  if (message && message.type === 'resizeConfirm' && confirmWindowId !== undefined) {
    // 按服务器数量动态调整 confirm 弹窗高度（去掉了顶部标题栏）
    const serverCount = Number(message.serverCount) || 0
    const width = 380
    // 紧凑布局：文件信息 38 + 选择设备标签 20 + 设备按钮 N×48 + 间隔 N×6 + 浏览器下载 40 + 上下 padding 16
    const height = Math.min(
      Math.max(180, 128 + serverCount * 54 + 16),
      520,
    )
    chrome.windows.update(confirmWindowId, { width, height }).catch(() => {
      confirmWindowId = undefined
    })
    sendResponse({ ok: true, height })
    return true
  }

  if (message && message.type === 'closeConfirm' && confirmWindowId !== undefined) {
    chrome.windows.remove(confirmWindowId).catch(() => {})
    confirmWindowId = undefined
    sendResponse({ ok: true })
    return true
  }
})
