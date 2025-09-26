import type { CancellationToken } from 'vscode'
import axios from 'axios'

export function createAxiosCancelToken(cancelToken?: CancellationToken) {
  const axiosCancelToken = axios.CancelToken.source()
  cancelToken?.onCancellationRequested(() => {
    axiosCancelToken.cancel()
  })
  return axiosCancelToken
}
