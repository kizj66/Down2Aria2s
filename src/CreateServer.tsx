import { batch } from 'solid-js'
import { createStore } from 'solid-js/store'
import { ReturnBack, Save, ServerInfos, aria2Status, getStorage, setStorage } from './util'
import Selector from './Selector'

const CreateServer = (props: { onBack: (flag: boolean) => void }) => {
  type AriaInvalid = boolean | undefined

  const [serverInfo, setServerInfo] = createStore<{
    title: string
    protocal: string
    host: string
    port: string
    pathname: string
    token: string
    invalid: {
      title: AriaInvalid
      host: AriaInvalid
      port: AriaInvalid
    }
  }>({
    title: '',
    protocal: 'http',
    host: '',
    port: '6800',
    pathname: 'jsonrpc',
    token: '',
    invalid: {
      title: undefined,
      host: undefined,
      port: undefined,
    },
  })

  const handleSubmit = async () => {
    if (
      serverInfo.invalid.title === undefined &&
      serverInfo.invalid.host === undefined &&
      serverInfo.invalid.port === undefined
    ) {
      batch(() => {
        setServerInfo('invalid', 'title', true)
        setServerInfo('invalid', 'host', true)
        setServerInfo('invalid', 'port', false)
      })
      return
    }
    if (serverInfo.invalid.title || serverInfo.invalid.host || serverInfo.invalid.port) return
    const serverInfos: ServerInfos = (await getStorage()) || []
    const contains = serverInfos.some(v => v.title === serverInfo.title)
    if (contains) {
      batch(() => {
        setServerInfo('title', '')
        setServerInfo('invalid', 'title', true)
      })
      return
    }
    const url =
      serverInfo.protocal + '://' + serverInfo.host + ':' + serverInfo.port + '/' + serverInfo.pathname
    const ok = await aria2Status(url, serverInfo.token)
    if (!ok) return
    const info = {
      title: serverInfo.title,
      url,
      token: serverInfo.token,
    }
    serverInfos.push(info)
    await setStorage(serverInfos)
    props.onBack(false)
  }

  const protocalData = [
    {
      Name: 'http',
      Value: 'http',
    },
    {
      Name: 'https',
      Value: 'https',
    },
  ]

  return (
    <>
      <div class="flex h-12 w-full items-center justify-between rounded-lg bg-app-card px-3">
        <div
          onClick={() => props.onBack(false)}
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-app-secondary transition-colors hover:bg-app-card-hover hover:text-app-primary"
        >
          <ReturnBack class="text-xl" />
        </div>
        <span class="text-sm font-medium text-app-primary">{chrome.i18n.getMessage('addDevice') || '添加设备'}</span>
        <div
          onClick={handleSubmit}
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-primary transition-colors hover:bg-app-card-hover"
        >
          <Save class="text-xl" />
        </div>
      </div>
      <input
        onChange={e => {
          const value = e.target.value.trim()
          if (value !== '') {
            setServerInfo('title', value)
          }
          setServerInfo('invalid', 'title', value === '')
        }}
        aria-invalid={serverInfo.invalid.title}
        placeholder={chrome.i18n.getMessage('title')}
        class="h-14 w-full rounded-lg border border-app-border bg-app-card px-3 text-sm text-app-primary outline-none transition-colors placeholder:text-app-muted focus:border-primary aria-[invalid=true]:border-error"
      />
      <div class="flex h-14 w-full flex-row items-center rounded-lg border border-app-border bg-app-card pl-3">
        <p class="flex w-20 items-center text-sm text-app-secondary">{chrome.i18n.getMessage('protocal')}</p>
        <div class="flex-1">
          <Selector
            data={protocalData}
            default="http"
            onSelect={v => setServerInfo('protocal', v.Value)}
          />
        </div>
      </div>
      <input
        onChange={e => {
          const value = e.target.value.trim()
          if (value !== '') {
            setServerInfo('host', value)
          }
          setServerInfo('invalid', 'host', value === '')
        }}
        aria-invalid={serverInfo.invalid.host}
        placeholder={chrome.i18n.getMessage('host')}
        class="h-14 w-full rounded-lg border border-app-border bg-app-card px-3 text-sm text-app-primary outline-none transition-colors placeholder:text-app-muted focus:border-primary aria-[invalid=true]:border-error"
      />
      <div class="flex h-14 w-full flex-row gap-2">
        <input
          onChange={e => {
            const value = e.target.value.trim()
            const regx =
              /^([0-9]|[1-9]\d{1,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/
            if (regx.test(value)) {
              setServerInfo('port', value)
            }
            setServerInfo('invalid', 'port', !regx.test(value))
          }}
          aria-invalid={serverInfo.invalid.port}
          placeholder={chrome.i18n.getMessage('port')}
          value={6800}
          class="h-14 w-[45%] rounded-lg border border-app-border bg-app-card px-3 text-sm text-app-primary outline-none transition-colors placeholder:text-app-muted focus:border-primary aria-[invalid=true]:border-error"
        />
        <div class="flex h-14 w-[10%] items-center justify-center text-app-muted">/</div>
        <input
          onChange={e => setServerInfo('pathname', e.target.value.trim())}
          value="jsonrpc"
          placeholder={chrome.i18n.getMessage('path')}
          class="h-14 w-[45%] rounded-lg border border-app-border bg-app-card px-3 text-sm text-app-primary outline-none transition-colors placeholder:text-app-muted focus:border-primary"
        />
      </div>
      <input
        onChange={e => setServerInfo('token', e.target.value.trim())}
        placeholder={chrome.i18n.getMessage('token')}
        class="h-14 w-full rounded-lg border border-app-border bg-app-card px-3 text-sm text-app-primary outline-none transition-colors placeholder:text-app-muted focus:border-primary"
      />
    </>
  )
}

export default CreateServer
