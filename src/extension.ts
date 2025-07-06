import type { PackageDataItem } from './modules/PackageDataProvider'
import * as path from 'node:path'
import axios from 'axios'
import * as vscode from 'vscode'
import { i18n, trace } from './common/common'
import { PackageDataProvider } from './modules/PackageDataProvider'
import { necessaryPackage, PackageManager } from './modules/PackageManager'
import { PythonExtension } from './modules/PythonExtension'

export interface ExtensionAPI {
  pip: PackageManager
}

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Pip Manager')
  outputChannel.clear()

  outputChannel.appendLine('Pip Manager Start')

  const pythonExtension = new PythonExtension(context)
  await pythonExtension.waitPythonExtensionInited()

  const pythonPath = pythonExtension.pythonPath
  outputChannel.appendLine(`Pip Manager Got python path at ${pythonPath}`)

  const pip = new PackageManager(pythonPath, outputChannel, context)
  const packageDataProvider = new PackageDataProvider(pip)

  pythonExtension.onPythonPathChange((newPythonPath) => {
    pip.updatePythonPath(newPythonPath)
    packageDataProvider.refresh()
  })

  // Tree View
  const pipManagerTreeView = vscode.window.createTreeView('pip-manager-installed', {
    treeDataProvider: packageDataProvider,
  })
  pipManagerTreeView.onDidChangeVisibility((e) => {
    if (e.visible) {
      trace.openView()
    }
  })
  context.subscriptions.push(pipManagerTreeView)

  // Helper functions
  const addPackage = async (name?: string) => {
    if (name) {
      outputChannel.clear()
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: i18n.localize('pip-manager.tip.addPackage', 'installing package %0%', name),
        cancellable: true,
      }, async (progress, cancelToken) => {
        await pip.addPackage(name, cancelToken)
        packageDataProvider.refresh()
      })
    }
  }

  const updatePackage = async function (name?: string) {
    if (name) {
      outputChannel.clear()
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: i18n.localize('pip-manager.tip.updatePackage', 'update package %0%', name),
        cancellable: true,
      }, async (progress, cancelToken) => {
        await pip.updatePackage(name, cancelToken)
        packageDataProvider.refresh()
      })
    }
  }

  const checkRemovePackage = (name: string) => {
    if (necessaryPackage.includes(name)) {
      vscode.window.showWarningMessage(i18n.localize('pip-manager.tip.disableRemove', 'package %0% cannot remove', `${necessaryPackage}`))
      return false
    }
    return true
  }

  // Register commands directly
  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.refreshPackage', () => {
    packageDataProvider.refresh()
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.addPackage', async (name?: string) => {
    let value = ''
    value = name || await vscode.window.showInputBox({ title: i18n.localize('pip-manager.input.addPackage', 'input install package name') }) || ''
    await addPackage(value)
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.updatePackage', async (e?: PackageDataItem) => {
    if (!e?.name) {
      return
    }
    await updatePackage(e.name)
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.removePackage', async (e?: PackageDataItem) => {
    let value = ''
    value = e ? e.name : await vscode.window.showInputBox({ title: i18n.localize('pip-manager.input.removePackage', 'input remove package name') }) || ''

    if (!(value && checkRemovePackage(value.split('==')[0]))) {
      return false
    }
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: i18n.localize('pip-manager.tip.removePackage', 'remove package %0%', value),
    }, async () => {
      await pip.removePackage(value)
      packageDataProvider.refresh()
    })
    return true
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.packageDescription', async (e?: PackageDataItem) => {
    let value = ''
    value = e ? e.name : await vscode.window.showInputBox({ title: i18n.localize('pip-manager.input.packageDescription', 'input find package name') }) || ''
    if (!value) {
      return
    }
    vscode.env.openExternal(vscode.Uri.parse(`https://pypi.org/project/${value}/`))
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.copyPackageName', async (e?: PackageDataItem) => {
    if (!e) {
      return
    }
    const value = e.name
    if (!value) {
      return
    }
    await vscode.env.clipboard.writeText(value)
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.installRequirements', async (e?: vscode.Uri) => {
    if (!e) {
      return
    }
    const filePath = e.fsPath
    if (!filePath) {
      return
    }
    outputChannel.clear()
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: i18n.localize('pip-manager.tip.addPackageFromFile', 'installing package in %0%', path.basename(filePath)),
      cancellable: true,
    }, async (progress, cancelToken) => {
      await pip.addPackageFromFile(filePath, cancelToken)
      packageDataProvider.refresh()
    })
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.searchPackage', async () => {
    const qPick = vscode.window.createQuickPick()

    let rBusy = 0
    let timer: NodeJS.Timeout
    let lastCancelToken: vscode.CancellationTokenSource | undefined

    qPick.busy = true
    qPick.show()
    const defaultTitle = i18n.localize('pip-manager.pick.search.defaultTitle', 'search from PyPI')
    qPick.title = defaultTitle
    qPick.placeholder = i18n.localize('pip-manager.pick.search.placeholder', 'input to search')

    const btnTable = {
      dot: { iconPath: new vscode.ThemeIcon('debug-stackframe-dot') },
      left: { iconPath: new vscode.ThemeIcon('arrow-left'), tooltip: i18n.localize('pip-manager.pick.search.preBtn', 'pre page') },
      right: { iconPath: new vscode.ThemeIcon('arrow-right'), tooltip: i18n.localize('pip-manager.pick.search.nextBtn', 'next page') },
    }

    const clearSteps = () => {
      qPick.step = 0
      qPick.totalSteps = 0
      qPick.buttons = []
    }

    const setStep = (step: number, totalSteps?: number) => {
      qPick.step = step
      if (totalSteps) {
        qPick.totalSteps = totalSteps
      }
      const preBtn = qPick.step === 1 ? btnTable.dot : btnTable.left
      const nextBtn = qPick.step === qPick.totalSteps ? btnTable.dot : btnTable.right
      qPick.buttons = [preBtn, nextBtn]
    }

    const updateItemList = async function (value: string, page: number, clear = true) {
      if (lastCancelToken) {
        lastCancelToken.cancel()
      }
      const cancelToken = new vscode.CancellationTokenSource()
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
        updateItemList(value, 1)
      }, 300)
    })

    qPick.onDidChangeSelection((data) => {
      const item = data[0]
      qPick.hide()
      const value = item.label
      addPackage(value)
    })

    qPick.onDidTriggerButton((e) => {
      if (e === btnTable.left) {
        updateItemList(qPick.value, (qPick.step || 0) - 1, false)
      }
      if (e === btnTable.right) {
        updateItemList(qPick.value, (qPick.step || 0) + 1, false)
      }
    })

    qPick.onDidHide(() => {
      qPick.dispose()
      lastCancelToken?.dispose()
    })

    updateItemList('', 1)
  }))

  context.subscriptions.push(vscode.commands.registerCommand('pip-manager.pickPackageVersion', async (e?: PackageDataItem) => {
    let pack = ''
    pack = e ? e.name : await vscode.window.showInputBox({ title: i18n.localize('pip-manager.input.pickPackageVersion', 'input pick version package name') }) || ''

    pack = pack.split('==')[0]
    if (!(pack)) {
      return false
    }

    let versionList: string[] = []

    outputChannel.clear()
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: i18n.localize('pip-manager.tip.pickPackageVersion', 'check %0% version', pack),
      cancellable: true,
    }, async (progress, cancelToken) => {
      versionList = await pip.getPackageVersionList(pack, cancelToken)
    })

    if (!versionList.length) {
      vscode.window.showInformationMessage(i18n.localize('pip-manager.tip.noPackageVersion', 'no found version for %0%', pack))
      return
    }

    const quickPickItems: vscode.QuickPickItem[] = versionList.map((item) => {
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

    const selectedVersion = await new Promise<vscode.QuickPickItem | null>((resolve) => {
      const qPick = vscode.window.createQuickPick()
      let value: vscode.QuickPickItem | null = null
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
      vscode.commands.executeCommand('pip-manager.addPackage', `${pack}==${selectedVersion.label}`)
    }
  }))

  return { pip } as ExtensionAPI
}

export function deactivate(): void {}
