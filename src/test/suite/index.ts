import * as path from 'node:path'
import * as glob from 'glob'
import Mocha from 'mocha'

const mocha = new Mocha({
  ui: 'tdd',
  color: true,
})
export async function run(): Promise<void> {
  const testsRoot = path.resolve(__dirname, '..')
  const files = glob.sync('**/**.test.js', { cwd: testsRoot })
  return new Promise((resolve, reject) => {
    files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)))
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`))
      } else {
        resolve()
      }
    })
  })
}
