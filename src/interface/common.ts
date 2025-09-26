import type * as vscode from 'vscode'
import { createDecorator } from '@/common/ioc/common/instantiation'

export type OutputChannelType = vscode.OutputChannel
export const IOutputChannel = createDecorator<OutputChannelType>('outputChannel')

export type ExtensionContextType = vscode.ExtensionContext
export const IExtensionContext = createDecorator<ExtensionContextType>('extensionContext')
