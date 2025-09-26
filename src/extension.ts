import type { ExtensionContext, QuickPickItem } from 'vscode'
import type { OutputChannelType } from './interface/common'
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import type { PackageDataItem } from './modules/PackageDataProvider'
import { basename } from 'node:path'
import axios from 'axios'
import { CancellationTokenSource, commands, env, ProgressLocation, ThemeIcon, Uri, window } from 'vscode'
import { i18n } from './common/i18n/localize'
import { InstantiationService } from './common/ioc'
import { ServiceCollection } from './common/ioc/common/serviceCollection'
import trace from './common/trace'
import { IExtensionContext, IOutputChannel } from './interface/common'
import { CommandTool } from './modules/CommandTool'
import { PackageDataProvider } from './modules/PackageDataProvider'
import { necessaryPackage, PackageManager } from './modules/PackageManager'
import { PythonExtension } from './modules/PythonExtension'

export interface ExtensionAPI {
  pip: PackageManager
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: ExtensionContext) {
  // start register services
  const services = new ServiceCollection()
  const instantiationService = new InstantiationService(services)
  const outputChannel: OutputChannelType = window.createOutputChannel('Pip Manager')
  outputChannel.clear()

  services.set(IExtensionContext, context)
  services.set(IOutputChannel, outputChannel)

  const commandTool = CommandTool.Create(instantiationService, services)

  commandTool.registerEmptyCommand([
    'pip-manager.addPackage',
    'pip-manager.refreshPackage',
    'pip-manager.searchPackage',
  ])

  outputChannel.appendLine('Pip Manager Start')

  const pythonExtension = PythonExtension.Create(instantiationService, services)
  await pythonExtension.waitPythonExtensionInited()

  const pythonPath = pythonExtension.pythonPath
  outputChannel.appendLine(`Pip Manager Got python path at ${pythonPath}`)

  const pip = PackageManager.Create(instantiationService, services, pythonPath)
  const packageDataProvider = PackageDataProvider.Create(instantiationService, services)

  pythonExtension.onPythonPathChange((newPythonPath) => {
    pip.updatePythonPath(newPythonPath)
    packageDataProvider.refresh()
  })

  // after services registered

  async function addPackage(name?: string) {
    if (name) {
      outputChannel.clear()
      await window.withProgress({
        location: ProgressLocation.Notification,
        title: i18n.localize('pip-manager.tip.addPackage', 'installing package %0%', name),
        cancellable: true,
      }, async (progress, cancelToken) => {
        await pip.addPackage(name, cancelToken)
        packageDataProvider.refresh()
      })
    }
  }

  async function updatePackage(name?: string) {
    if (name) {
      outputChannel.clear()
      await window.withProgress({
        location: ProgressLocation.Notification,
        title: i18n.localize('pip-manager.tip.updatePackage', 'update package %0%', name),
        cancellable: true,
      }, async (progress, cancelToken) => {
        await pip.updatePackage(name, cancelToken)
        packageDataProvider.refresh()
      })
    }
  }

  function checkRemovePackage(name: string) {
    if (necessaryPackage.includes(name)) {
      window.showWarningMessage(i18n.localize('pip-manager.tip.disableRemove', 'package %0% cannot remove', name))
      return false
    }
    return true
  }

  // ======================

  const pipManagerTreeView = window.createTreeView('pip-manager-installed', {
    treeDataProvider: packageDataProvider,
  })
  pipManagerTreeView.onDidChangeVisibility((e) => {
    if (e.visible) {
      trace.openView()
    }
  })
  context.subscriptions.push(pipManagerTreeView)

  commandTool.registerCommand('pip-manager.refreshPackage', () => {
    packageDataProvider.refresh()
  })

  commandTool.registerCommand('pip-manager.addPackage', async (name?: string) => {
    const value = name || await window.showInputBox({ title: i18n.localize('pip-manager.input.addPackage', 'input install package name') }) || ''
    await addPackage(value)
  })

  commandTool.registerCommand('pip-manager.updatePackage', async (e?: PackageDataItem) => {
    if (!e?.name) {
      return
    }
    await updatePackage(e.name)
  })

  commandTool.registerCommand('pip-manager.removePackage', async (e?: PackageDataItem) => {
    const value = e ? e.name : await window.showInputBox({ title: i18n.localize('pip-manager.input.removePackage', 'input remove package name') }) || ''

    if (!(value && checkRemovePackage(value.split('==')[0]))) {
      return false
    }
    await window.withProgress({
      location: ProgressLocation.Notification,
      title: i18n.localize('pip-manager.tip.removePackage', 'remove package %0%', value),
    }, async () => {
      await pip.removePackage(value)
      packageDataProvider.refresh()
    })
    return true
  })
  commandTool.registerCommand('pip-manager.packageDescription', async (e?: PackageDataItem) => {
    const value = e ? e.name : await window.showInputBox({ title: i18n.localize('pip-manager.input.packageDescription', 'input find package name') }) || ''
    if (!value) {
      return
    }
    env.openExternal(Uri.parse(`https://pypi.org/project/${value}/`))
  })

  commandTool.registerCommand('pip-manager.copyPackageName', async (e?: PackageDataItem) => {
    if (!e) {
      return
    }
    const value = e.name
    if (!value) {
      return
    }
    await env.clipboard.writeText(value)
  })

  commandTool.registerCommand('pip-manager.installRequirements', async (e?: Uri) => {
    if (!e) {
      return
    }
    const filePath = e.fsPath
    if (!filePath) {
      return
    }
    outputChannel.clear()
    window.withProgress({
      location: ProgressLocation.Notification,
      title: i18n.localize('pip-manager.tip.addPackageFromFile', 'installing package in %0%', basename(filePath)),
      cancellable: true,
    }, async (progress, cancelToken) => {
      await pip.addPackageFromFile(filePath, cancelToken)
      packageDataProvider.refresh()
    })
  })

  commandTool.registerCommand('pip-manager.searchPackage', async () => {
    const qPick = window.createQuickPick()

    let rBusy = 0
    let timer: NodeJS.Timeout
    let lastCancelToken: CancellationTokenSource | undefined

    qPick.busy = true
    qPick.show()
    const defaultTitle = i18n.localize('pip-manager.pick.search.defaultTitle', 'search from PyPI')
    qPick.title = defaultTitle
    qPick.placeholder = i18n.localize('pip-manager.pick.search.placeholder', 'input to search')

    const btnTable = {
      dot: { iconPath: new ThemeIcon('debug-stackframe-dot') },
      left: { iconPath: new ThemeIcon('arrow-left'), tooltip: i18n.localize('pip-manager.pick.search.preBtn', 'pre page') },
      right: { iconPath: new ThemeIcon('arrow-right'), tooltip: i18n.localize('pip-manager.pick.search.nextBtn', 'next page') },
    }

    function clearSteps() {
      qPick.step = 0
      qPick.totalSteps = 0
      qPick.buttons = []
    }

    function setStep(step: number, totalSteps?: number) {
      qPick.step = step
      if (totalSteps) {
        qPick.totalSteps = totalSteps
      }
      const preBtn = qPick.step === 1 ? btnTable.dot : btnTable.left
      const nextBtn = qPick.step === qPick.totalSteps ? btnTable.dot : btnTable.right
      qPick.buttons = [preBtn, nextBtn]
    }

    async function updateItemList(value: string, page: number, clear = true) {
      if (lastCancelToken) {
        lastCancelToken.cancel()
      }
      const cancelToken = new CancellationTokenSource()
      lastCancelToken = cancelToken
      rBusy++
      qPick.busy = !!rBusy

      try {
        qPick.title = value ? i18n.localize('pip-manager.pick.search.resultTitle', 'search for %0%', value) : defaultTitle
        if (clear) {
          clearSteps()
        } else {
          setStep(page)
        }
        const data = await pip.searchFromPyPi(value, page, cancelToken.token)
        qPick.items = data.list
        setStep(page, data.totalPages)
        qPick.step = page
        qPick.totalSteps = data.totalPages
      } catch (err) {
        if (!axios.isCancel(err)) {
          qPick.title = i18n.localize('pip-manager.pick.search.noResultTitle', 'no search result')
          qPick.items = []
          qPick.step = 0
          qPick.totalSteps = 0
        }
      }
      cancelToken.dispose()
      rBusy--
      qPick.busy = !!rBusy
    }

    qPick.onDidChangeValue((value: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void updateItemList(value, 1)
      }, 300)
    })

    qPick.onDidChangeSelection(async (data) => {
      const item = data[0]
      qPick.hide()
      const value = item.label
      await addPackage(value)
    })

    qPick.onDidTriggerButton(async (e) => {
      if (e === btnTable.left) {
        await updateItemList(qPick.value, (qPick.step || 0) - 1, false)
      }
      if (e === btnTable.right) {
        await updateItemList(qPick.value, (qPick.step || 0) + 1, false)
      }
    })

    qPick.onDidHide(() => {
      qPick.dispose()
      lastCancelToken?.dispose()
    })

    await updateItemList('', 1)
  })

  commandTool.registerCommand('pip-manager.pickPackageVersion', async (e?: PackageDataItem) => {
    let pack = e ? e.name : await window.showInputBox({ title: i18n.localize('pip-manager.input.pickPackageVersion', 'input pick version package name') }) || ''

    pack = pack.split('==')[0]
    if (!(pack)) {
      return false
    }

    let versionList: string[] = []

    outputChannel.clear()
    await window.withProgress({
      location: ProgressLocation.Notification,
      title: i18n.localize('pip-manager.tip.pickPackageVersion', 'check %0% version', `${pack}`),
      cancellable: true,
    }, async (progress, cancelToken) => {
      versionList = await pip.getPackageVersionList(pack, cancelToken)
    })

    if (!versionList.length) {
      window.showInformationMessage(i18n.localize('pip-manager.tip.noPackageVersion', 'no found version for %0%', `${pack}`))
      return
    }

    const quickPickItems: QuickPickItem[] = versionList.map((item) => {
      const picked = (e?.version && e?.version === item) || false
      return {
        label: item,
        alwaysShow: true,
        description: picked
          ? i18n.localize('pip-manager.tip.currentVersion', '%0% current version', pack)
          : undefined,
        picked,
      }
    })

    const selectedVersion = await new Promise<QuickPickItem | null>((resolve) => {
      const qPick = window.createQuickPick()
      let value: QuickPickItem | null = null
      qPick.title = i18n.localize('pip-manager.tip.selectPackageVersion', 'select install version for %0%', pack)
      qPick.placeholder = e?.version
      qPick.items = quickPickItems
      qPick.activeItems = quickPickItems.filter(item => item.picked)

      qPick.onDidChangeSelection((e) => {
        value = e[0]
        qPick.hide()
      })
      qPick.onDidHide(() => {
        resolve(value)
        qPick.dispose()
      })

      qPick.show()
    })

    if (selectedVersion && selectedVersion.label !== e?.version) {
      commands.executeCommand('pip-manager.addPackage', `${pack}==${selectedVersion.label}`)
    }
  })

  return { pip } as ExtensionAPI
}

// this method is called when your extension is deactivated
export function deactivate() {}
