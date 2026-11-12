import { createLocalVue, mount } from '@vue/test-utils'
import VueRouter from 'vue-router'
import ElementUI from 'element-ui'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import AppMain from '@/layout/components/AppMain.vue'
import Restore from '@/views/CloudNative/Restore/index.vue'
import RestoreDialog from '@/components/Dialog/RestoreDialog.vue'

async function flush() {
  for (let index = 0; index < 24; index++) await Promise.resolve()
}

function backup(status) {
  return {
    id: 'backup-' + status,
    instanceId: 'instance-A',
    name: 'Backup ' + status,
    status,
    backupType: 'PHYSICAL',
    backupMode: 'FULL',
    backupMethod: 'MANUAL',
    isRestoring: status === 'RESTORING'
  }
}

describe('restore action availability from BackupVO.status', () => {
  let wrapper
  let transport
  let confirm
  let errors
  let savedUser
  let savedRoles

  beforeEach(async() => {
    jest.useFakeTimers()
    savedUser = localStorage.getItem('userId')
    savedRoles = localStorage.getItem('roles')
    localStorage.setItem('userId', 'user-7')
    localStorage.setItem('roles', JSON.stringify(['routine']))

    const localVue = createLocalVue()
    localVue.use(VueRouter)
    localVue.use(ElementUI)
    errors = []
    localVue.config.errorHandler = error => errors.push(error)
    const client = axios.create()
    localVue.prototype.axios = client
    transport = new MockAdapter(client)
    transport.onGet('/clusters').reply(200, [])
    transport.onGet('/instances/list/user-7').reply(200, [{
      id: 'instance-A',
      name: 'Database A',
      clusterId: 'cluster-A',
      clusterName: 'Cluster A',
      namespace: 'default',
      status: 'RUNNING',
      version: '5.6',
      type: 'ALONE',
      storageClass: 'standard',
      storage: 20,
      cpu: 2,
      memory: 4,
      network: [{ nodeIp: '192.0.2.10', nodePort: 30080 }]
    }])
    // BackupServiceImpl.listBackup returns non-deleted rows of any status.
    const records = ['RESTORING', 'COMPLETED', 'RESTORED', 'RESTORE_FAILED'].map(backup)
    transport.onGet('/instances/instance-A/backups/1/1000?filter=').reply(200, {
      pageNo: 1, pageSize: 1000, totalCount: records.length, data: records
    })

    const router = new VueRouter({
      mode: 'abstract',
      routes: [{ path: '/nativeCloud/Restore/index', component: Restore }]
    })
    router.push('/nativeCloud/Restore/index')
    wrapper = mount(AppMain, {
      localVue,
      router,
      sync: false,
      stubs: { 'svg-icon': true, transition: false, 'transition-group': false }
    })
    await flush()
    await wrapper.vm.$nextTick()
    jest.advanceTimersByTime(200)
    await flush()
    const view = wrapper.findAll('button').wrappers.find(button => button.text() === '查看')
    expect(view).toBeDefined()
    await view.trigger('click')
    await flush()
    await wrapper.vm.$nextTick()
    const dialog = wrapper.find(RestoreDialog)
    expect(dialog.vm.restoreVisible).toBe(true)
    expect(transport.history.get.some(request =>
      request.url === '/instances/instance-A/backups/1/1000?filter='
    )).toBe(true)
    expect(errors).toEqual([])
    // Observe the real Element UI confirmation without replacing it.
    confirm = jest.spyOn(dialog.vm, '$confirm')
  })

  afterEach(async() => {
    if (confirm) {
      if (confirm.mock.calls.length) ElementUI.MessageBox.close()
      confirm.mockRestore()
      confirm = undefined
    }
    if (wrapper) wrapper.destroy()
    await flush()
    if (transport) transport.restore()
    jest.clearAllTimers()
    jest.useRealTimers()
    if (savedUser == null) localStorage.removeItem('userId')
    else localStorage.setItem('userId', savedUser)
    if (savedRoles == null) localStorage.removeItem('roles')
    else localStorage.setItem('roles', savedRoles)
  })

  function action(status) {
    const dialog = wrapper.find(RestoreDialog)
    const rows = dialog.findAll('.el-table__body-wrapper tbody tr')
    const index = rows.wrappers.findIndex(row =>
      row.findAll('td').at(0).text() === 'Backup ' + status
    )
    expect(index).toBeGreaterThanOrEqual(0)
    const fixed = dialog.findAll('.el-table__fixed-right .el-table__fixed-body-wrapper tbody tr')
    const row = fixed.length ? fixed.at(index) : rows.at(index)
    const button = row.findAll('button').wrappers.find(item => item.text() === '恢复')
    expect(button).toBeDefined()
    return button.element
  }

  it('blocks the restore action while the backup is already restoring', () => {
    const button = action('RESTORING')
    expect(button.disabled).toBe(true)
    button.click()
    expect(confirm).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  })

  it('keeps all backend-eligible states enabled and opens the existing confirmation', () => {
    const buttons = ['COMPLETED', 'RESTORED', 'RESTORE_FAILED'].map(action)
    expect(buttons.map(button => button.disabled)).toEqual([false, false, false])
    buttons[0].click()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toContain('Backup COMPLETED')
    expect(errors).toEqual([])
  })
})
