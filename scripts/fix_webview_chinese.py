#!/usr/bin/env python3
"""Fix Chinese fallback strings in webview JS files and remaining TS files."""
import os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def fix_file(relpath, replacements):
    fpath = os.path.join(BASE, relpath.replace('/', os.sep))
    if not os.path.exists(fpath):
        print(f'SKIP (not found): {relpath}')
        return
    with open(fpath, encoding='utf-8') as f:
        content = f.read()
    changed = False
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new)
            changed = True
    if changed:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'  modified: {relpath}')
    else:
        print(f'  no changes: {relpath}')

# accountSwitchService.ts remaining
fix_file('src/services/accountSwitchService.ts', [
    (
        '`无感切号不可用：当前宿主不支持可用的切号接口（${selected.reason}），请改用默认方式。`',
        '`Seamless switch unavailable: host does not support switch interface (${selected.reason}), use default mode.`'
    ),
    (
        "'无感切号不可用：当前宿主不支持可用的切号接口（${selected.reason}），请改用默认方式。'",
        "'Seamless switch unavailable: host does not support switch interface (${selected.reason}), use default mode.'"
    ),
    (
        "'无感切号不可用：当前宿主不支持 OAuthPreferences.setOAuthTokenInfo，请切回默认方式。'",
        "'Seamless switch unavailable: host does not support OAuthPreferences.setOAuthTokenInfo, use default mode.'"
    ),
    (
        "'无感切号不可用：当前宿主不支持 antigravityAuth.setOAuthTokenInfo，请切回默认方式。'",
        "'Seamless switch unavailable: host does not support antigravityAuth.setOAuthTokenInfo, use default mode.'"
    ),
])

# cockpitToolsWs.ts remaining (template literals)
fix_file('src/services/cockpitToolsWs.ts', [
    (
        "`[WS] 收到外部切换模式Request: request_id=${modePayload.request_id ?? 'none'}, mode=${modePayload.switch_mode ?? 'none'}`",
        "`[WS] Received external switch mode request: request_id=${modePayload.request_id ?? 'none'}, mode=${modePayload.switch_mode ?? 'none'}`"
    ),
    (
        "`[WS] 收到外部切号Request: request_id=${switchPayload.request_id ?? 'none'}, target=${switchPayload.target_email ?? 'none'}, mode=${switchPayload.switch_mode ?? 'auto'}`",
        "`[WS] Received external account switch request: request_id=${switchPayload.request_id ?? 'none'}, target=${switchPayload.target_email ?? 'none'}, mode=${switchPayload.switch_mode ?? 'auto'}`"
    ),
])

# accountTree.ts
fix_file('src/view/accountTree.ts', [
    (
        '`已无感切换到Account：${result.email ?? node.email}`',
        '`Seamlessly switched to account: ${result.email ?? node.email}`'
    ),
])

# quickpick_view.ts
fix_file('src/view/quickpick_view.ts', [
    (
        '`请等待 ${remaining} 秒后再Refresh`',
        '`Please wait ${remaining} seconds before refreshing`'
    ),
])

# auto_trigger.js
fix_file('src/view/webview/auto_trigger.js', [
    (
        '`<li style="color: var(--vscode-errorForeground)">Invalid的 Crontab 表达式</li>`',
        '`<li style="color: var(--vscode-errorForeground)">Invalid Crontab expression</li>`'
    ),
])

# auth_ui.js fallback strings
fix_file('src/view/webview/auth_ui.js', [
    ("|| '点击Email可切换查看配额'", "|| 'Click email to switch quota view'"),
    ("|| '点击\"切换登录\"可切换客户端登录Account'", "|| 'Click \"Switch Login\" to change client login account'"),
    ("|| '切换登录'", "|| 'Switch Login'"),
    ("|| '切换登录Account'", "|| 'Switch Login Account'"),
    ("|| '确定要切换到以下Account吗？'", "|| 'Switch to the following account?'"),
    ("|| '此操作将重启 Antigravity 客户端以DoneAccount切换。'", "|| 'This will restart Antigravity client to complete account switch.'"),
    ("|| '确认'", "|| 'Confirm'"),
    ("|| '功能说明'", "|| 'Feature Description'"),
    ("|| '展开详情说明'", "|| 'Expand details'"),
    ("|| '查看数据访问与Sync/Import规则。'", "|| 'View data access and sync/import rules.'"),
    ("|| '数据访问说明'", "|| 'Data Access Info'"),
    ("|| '本功能会读取您本地 Antigravity Tools 与 Antigravity 客户端的AccountInformation，仅用于本插件Authorization/切换。'",
     "|| 'This feature reads your local Antigravity Tools and client account info, used only for plugin authorization/switching.'"),
    ("|| 'Antigravity 客户端Path'", "|| 'Antigravity Client Path'"),
    ("|| '读取内容'", "|| 'Data Read'"),
    ("|| 'AccountEmail、Refresh Token（本地读取）'", "|| 'Account Email, Refresh Token (local read)'"),
    ("|| '手动Import'", "|| 'Manual Import'"),
    ("|| '分别Import本地Account或 Antigravity Tools Account，仅执行一次。'",
     "|| 'Import local or Antigravity Tools accounts separately, one-time operation.'"),
    ("|| 'Import本地Account'", "|| 'Import Local Account'"),
    ("|| '选择登录方式'", "|| 'Select Login Method'"),
    ("|| '请选择读取本地已AuthorizationAccount或Authorization登录。'",
     "|| 'Choose to read local authorized account or authorize via OAuth.'"),
    ("|| 'Authorization登录适用于无客户端；本地读取仅对当前机器生效。'",
     "|| 'OAuth login for headless use; local read applies to current machine only.'"),
    ("|| '读取本地已AuthorizationAccount'", "|| 'Read Local Authorized Account'"),
    ("|| '读取本机 Antigravity 客户端已AuthorizationAccount，不重新Authorization，仅复用现有Authorization。'",
     "|| 'Read locally authorized account from Antigravity client, reuses existing authorization.'"),
    ("|| '读取本地Authorization'", "|| 'Read Local Authorization'"),
    ("|| 'Authorization登录（云端Authorization）'", "|| 'OAuth Login (Cloud Authorization)'"),
    ("|| '通过 Google OAuth 新Authorization，适用于无客户端场景，可撤销。'",
     "|| 'New authorization via Google OAuth, for headless use, revocable.'"),
    ("|| '去Authorization登录'", "|| 'Go Authorize'"),
])

# dashboard.js HTML comments
fix_file('src/view/webview/dashboard.js', [
    ('<!-- 数据访问说明 -->', '<!-- Data Access Info -->'),
    ('<!-- 手动Import -->', '<!-- Manual Import -->'),
    ("<!-- Account列表将在这里动态渲染 -->", '<!-- Account list will be rendered here dynamically -->'),
    # fallback strings
    ("|| 'Account数据已Updating'", "|| 'Account data updated'"),
    ("|| '已切换至 {email}'", "|| 'Switched to {email}'"),
    ("|| '功能说明'", "|| 'Feature Description'"),
    ("|| '展开详情说明'", "|| 'Expand details'"),
    ("|| '查看数据访问与Sync/Import规则。'", "|| 'View data access and sync/import rules.'"),
    ("|| '数据访问说明'", "|| 'Data Access Info'"),
    ("|| '本功能会读取您本地 Antigravity Tools 与 Antigravity 客户端的AccountInformation，仅用于本插件Authorization/切换。'",
     "|| 'This feature reads local Antigravity Tools and client account info for authorization/switching.'"),
    ("|| 'Antigravity 客户端Path'", "|| 'Antigravity Client Path'"),
    ("|| '读取内容'", "|| 'Data Read'"),
    ("|| 'AccountEmail、Refresh Token（本地读取）'", "|| 'Account Email, Refresh Token (local read)'"),
    ("|| '手动Import'：", "|| 'Manual Import':"),
    ("|| '手动Import'", "|| 'Manual Import'"),
    ("|| '分别Import本地Account或 Antigravity Tools Account，仅执行一次。'",
     "|| 'Import local or Antigravity Tools accounts separately, one-time.'"),
    ("|| 'Import本地Account'", "|| 'Import Local Account'"),
    ("|| 'In progress检测本地Authorization'", "|| 'Detecting local authorization...'"),
    ("|| 'In progress读取本地已AuthorizationAccountInformation，请稍候…'",
     "|| 'Reading local authorized account info, please wait...'"),
    ("|| 'In progress检测本地AuthorizationAccount'", "|| 'Detecting local authorized account...'"),
    ("|| '确认Sync本地Authorization'", "|| 'Confirm Sync Local Authorization'"),
    ("|| '已检测到本地已AuthorizationAccount，是否Sync到插件中？'",
     "|| 'Local authorized account detected, sync to plugin?'"),
    ("|| '检测到Account'", "|| 'Account detected'"),
    ("|| '未知Account'", "|| 'Unknown account'"),
    ("|| '该AccountAlready exists，继续将覆盖本地Saving的AuthorizationInformation。'",
     "|| 'Account already exists, continuing will overwrite locally saved authorization.'"),
    ("|| '将Import并切换为该Account。'", "|| 'Will import and switch to this account.'"),
    ("|| '覆盖并Sync'", "|| 'Overwrite and Sync'"),
    ("|| '确认Sync'", "|| 'Confirm Sync'"),
    ("|| '手动Import JSON'", "|| 'Manual Import JSON'"),
    ("|| '未检测到本地 Antigravity Tools Account，可通过 JSON File或粘贴内容Import。'",
     "|| 'No local Antigravity Tools account detected. Import via JSON file or paste.'"),
    ("|| '选择 JSON File'", "|| 'Select JSON File'"),
    ("|| '未选择File'", "|| 'No file selected'"),
    ("placeholder='${i18n['antigravityToolsSync.manualImportPlaceholder'] || '粘贴 JSON 数组，例如: [{\"email\":\"a@b.com\",\"refresh_token\":\"...\"}]'}'",
     "placeholder='${i18n['antigravityToolsSync.manualImportPlaceholder'] || 'Paste JSON array, e.g. [{\"email\":\"a@b.com\",\"refresh_token\":\"...\"}]'}'"),
    ("|| '内容仅在本地解析，不会上传。'", "|| 'Content is parsed locally and will not be uploaded.'"),
    ("|| '仅Import'", "|| 'Import Only'"),
    ("|| '请粘贴或选择 JSON File'", "|| 'Please paste or select a JSON file'"),
    ("|| 'Invalid条目'", "|| 'Invalid entries'"),
    ("|| '将Import'", "|| 'Will import'"),
    ("|| '个Account'", "|| 'accounts'"),
    ("|| '粘贴 JSON'", "|| 'Paste JSON'"),
    ("|| '请提供Valid JSON'", "|| 'Please provide valid JSON'"),
    ("|| 'Cancel中...'", "|| 'Cancelling...'"),
    ("|| '切换至当前登录Account'", "|| 'Switch to current login account'"),
    ("|| '当前Account'", "|| 'Current Account'"),
    ("|| '点击Email可切换查看配额'", "|| 'Click email to switch quota view'"),
    ("|| '点击\"切换登录\"可切换客户端登录Account'", "|| 'Click \"Switch Login\" to change login account'"),
    ("|| '切换登录'", "|| 'Switch Login'"),
    ("|| '切换登录Account'", "|| 'Switch Login Account'"),
    ("|| '确定要切换到以下Account吗？'", "|| 'Switch to the following account?'"),
    ("|| '此操作将重启 Antigravity 客户端以DoneAccount切换。'",
     "|| 'This will restart Antigravity client to complete account switch.'"),
    ("|| '确认'", "|| 'Confirm'"),
    ("|| '选择登录方式'", "|| 'Select Login Method'"),
    ("|| '请选择读取本地已AuthorizationAccount或Authorization登录。'",
     "|| 'Choose to read local authorized account or authorize via OAuth.'"),
    ("|| 'Authorization登录适用于无客户端；本地读取仅对当前机器生效。'",
     "|| 'OAuth login for headless use; local read applies to current machine only.'"),
    ("|| '读取本地已AuthorizationAccount'", "|| 'Read Local Authorized Account'"),
    ("|| '读取本机 Antigravity 客户端已AuthorizationAccount，不重新Authorization，仅复用现有Authorization。'",
     "|| 'Read locally authorized account, reuses existing authorization.'"),
    ("|| '读取本地Authorization'", "|| 'Read Local Authorization'"),
    ("|| 'Authorization登录（云端Authorization）'", "|| 'OAuth Login (Cloud)'"),
    ("|| '通过 Google OAuth 新Authorization，适用于无客户端场景，可撤销。'",
     "|| 'New authorization via Google OAuth, for headless use, revocable.'"),
    ("|| '去Authorization登录'", "|| 'Go Authorize'"),
])

print('All done.')
