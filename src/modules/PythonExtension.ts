import type { Event, Extension, ExtensionContext, Uri } from 'vscode'
import { extensions } from 'vscode'

interface PythonExtensionApi {
  ready: Promise<void>
  jupyter: { registerHooks: () => void }
  debug: {
    getRemoteLauncherCommand: (host: string, port: number, waitUntilDebuggerAttaches: boolean) => Promise<string[]>
    getDebuggerPackagePath: () => Promise<string | undefined>
  }
  settings: {
    readonly onDidChangeExecutionDetails: Event<Uri | undefined>
    getExecutionDetails: (resource?: any) => { execCommand: string[] | undefined }
  }
  datascience: {
    showDataViewer: (dataProvider: any, title: string) => Promise<void>
    registerRemoteServerProvider: (serverProvider: any) => void
  }
}

export class PythonExtension {
  private _pythonExtension: Extension<PythonExtensionApi> | undefined
  constructor(private _context: ExtensionContext) {
    this.updatePythonExtension()
  }

  private updatePythonExtension() {
    this._pythonExtension = extensions.getExtension<PythonExtensionApi>('ms-python.python')
  }

  get pythonExtension() {
    if (this._pythonExtension) {
      return this._pythonExtension
    }
    this.updatePythonExtension()
    return this._pythonExtension
  }

  getPythonPath() {
    if (!this.pythonExtension) {
      return ''
    }
    const executionDetails = this.pythonExtension.exports.settings.getExecutionDetails()
    return executionDetails?.execCommand?.[0] || ''
  }

  get pythonPath() {
    return this.getPythonPath()
  }

  private async waitPythonPath() {
    let timer: NodeJS.Timeout | null = null
    return new Promise<string>((resolve) => {
      const tryResolvePythonPath = () => {
        const pythonPath = this.getPythonPath()
        if (pythonPath) {
          resolve(pythonPath)
        }
      }
      tryResolvePythonPath()
      timer = setInterval(tryResolvePythonPath, 1000)
    }).finally(() => {
      if (timer !== null) {
        clearInterval(timer)
      }
    })
  }

  async waitPythonExtensionInited() {
    await this.waitPythonPath()
  }

  onPythonPathChange(callback: (pythonPath: string) => any) {
    const dispose = this.pythonExtension?.exports.settings.onDidChangeExecutionDetails(() => {
      const pythonPath = this.getPythonPath()
      return callback(pythonPath)
    })
    if (dispose) {
      this._context.subscriptions.push(dispose)
    }
  }
}
