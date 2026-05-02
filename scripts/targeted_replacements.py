#!/usr/bin/env python3
"""Targeted replacement of Chinese strings in specific files."""
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REPLACEMENTS = {
    'src/auto_trigger/types.ts': [
        ('// "22:00" (optional，不填则全天)', '// "22:00" (optional, omit for all day)'),
    ],
    'src/services/accountsRefreshService.ts': [
        ("'[AccountsRefresh] Skipped配额Refresh (skipQuotaRefresh=true)'",
         "'[AccountsRefresh] Skipped quota refresh (skipQuotaRefresh=true)'"),
    ],
    'src/services/accountSwitchService.ts': [
        ("'Cockpit Tools 未运行或未Connection'", "'Cockpit Tools not running or not connected'"),
        ("'未找到该Account对应的 Tools ID'", "'Account Tools ID not found'"),
        ("'无感切号不可用：当前宿主不支持可用的切号接口（${selected.reason}），请改用默认方式。'",
         "'Seamless switch unavailable: host does not support available switch interface (${selected.reason}), use default mode.'"),
        ("'无感切号不可用：当前宿主不支持 OAuthPreferences.setOAuthTokenInfo，请切回默认方式。'",
         "'Seamless switch unavailable: host does not support OAuthPreferences.setOAuthTokenInfo, switch to default mode.'"),
        ("': '无感切号不可用：当前宿主不支持 antigravityAuth.setOAuthTokenInfo，请切回默认方式。'",
         "': 'Seamless switch unavailable: host does not support antigravityAuth.setOAuthTokenInfo, switch to default mode.'"),
        ("'未找到该Account的本地凭据'", "'Local credentials not found for account'"),
        ("'Account凭据不完整，缺少 refresh_token'", "'Incomplete account credentials, missing refresh_token'"),
        ("'Account expiresAt Invalid，无法进行无感切号'", "'Account expiresAt invalid, cannot perform seamless switch'"),
        ("'Account凭据不完整，缺少 access_token'", "'Incomplete account credentials, missing access_token'"),
        ("'未找到该Account的本地凭据，无法执行无感切号'", "'Local credentials not found, cannot perform seamless switch'"),
        ("'该Account refresh_token 已失效，请重新Authorization后再切换'",
         "'Account refresh_token has expired, please re-authorize before switching'"),
        ("'该Account access_token 已过期，请重新Authorization后再切换'",
         "'Account access_token has expired, please re-authorize before switching'"),
        ('`Refresh目标Account access_token Failed：${error || \'未知Error\'}`',
         "`Failed to refresh target account access_token: ${error || 'unknown error'}`"),
        ("error || '无感切号Failed：目标Account token 不可用'",
         "error || 'Seamless switch failed: target account token unavailable'"),
        ('`无感切号调用Timeout：${stage}`', '`Seamless switch call timeout: ${stage}`'),
    ],
    'src/services/cockpitToolsLocal.ts': [
        ("`[CockpitToolsLocal] 读取 accounts.json Failed: ${err}`",
         "`[CockpitToolsLocal] Failed to read accounts.json: ${err}`"),
    ],
    'src/services/cockpitToolsSync.ts': [
        ("`[Sync] 推送Account到 Tools Failed: ${email} - ${result.message}`",
         "`[Sync] Failed to push account to Tools: ${email} - ${result.message}`"),
        ("`[Sync] 双向SyncFailed: ${err.message}`", "`[Sync] Bidirectional sync failed: ${err.message}`"),
        ("'[Sync] 可能是桌面端未升级到支持 accounts_with_tokens 的版本'",
         "'[Sync] Desktop app may not be upgraded to support accounts_with_tokens'"),
    ],
    'src/services/cockpitToolsWs.ts': [
        ("'[WS] 读取服务ConfigurationFailed:'", "'[WS] Failed to read service configuration:'"),
        ("'[WS] 读取 WSL 默认网关Failed，将尝试 resolv.conf:'",
         "'[WS] Failed to read WSL default gateway, will try resolv.conf:'"),
        ("'[WS] 读取 /etc/resolv.conf Failed，将回退 localhost:'",
         "'[WS] Failed to read /etc/resolv.conf, falling back to localhost:'"),
        ("`[WS] 从ConfigurationFile读取端口: ${config.ws_port}, host=${host}`",
         "`[WS] Read port from config file: ${config.ws_port}, host=${host}`"),
        ("'[WS] 未Connection，无法发送Message'", "'[WS] Not connected, cannot send message'"),
        ("'[WS] 发送MessageFailed:'", "'[WS] Failed to send message:'"),
        ("'未Connection到 Cockpit Tools'", "'Not connected to Cockpit Tools'"),
        ("'发送RequestFailed'", "'Failed to send request'"),
        ("'[WS] 检测到未Connection，In progress尝试强制RestoreConnection...'",
         "'[WS] Detected disconnection, attempting forced reconnect...'"),
        ("'[WS] 等待ConnectionSuccess，继续执行操作'", "'[WS] Waiting for connection, continuing operation'"),
        ("`[WS] 等待ConnectionTimeout (${timeoutMs}ms)`", "`[WS] Connection wait timeout (${timeoutMs}ms)`"),
        ("`[WS] 检测到端口变化: ${this.lastWsUrl} -> ${wsUrl}`",
         "`[WS] Port change detected: ${this.lastWsUrl} -> ${wsUrl}`"),
        ("`[WS] In progressConnection ${wsUrl}... (尝试次数: ${this.reconnectFailCount + 1})`",
         "`[WS] Connecting to ${wsUrl}... (attempt: ${this.reconnectFailCount + 1})`"),
        ("`[WS] Connection关闭: ${event.code}`", "`[WS] Connection closed: ${event.code}`"),
        ("'Connection已Disconnected'", "'Connection disconnected'"),
        ("payload.error as string || '未知Error'", "payload.error as string || 'unknown error'"),
        ("`[WS] Cockpit Tools 就绪, 版本: ${readyPayload.version}`",
         "`[WS] Cockpit Tools ready, version: ${readyPayload.version}`"),
        ("`[WS] 数据变更: ${changedPayload.source}`", "`[WS] Data changed: ${changedPayload.source}`"),
        ("`[WS] Account切换Done: ${switchedPayload.email}`",
         "`[WS] Account switch done: ${switchedPayload.email}`"),
        ("`[WS] 切换Failed: ${errorPayload.message}`", "`[WS] Switch failed: ${errorPayload.message}`"),
        ("`[WS] 语言变更: ${languagePayload.language}`",
         "`[WS] Language changed: ${languagePayload.language}`"),
        ("`[WS] 唤醒互斥Status: enabled=${overridePayload.enabled}`",
         "`[WS] Wake exclusion status: enabled=${overridePayload.enabled}`"),
        ("'[WS] 收到外部切换模式Request:", "'[WS] Received external switch mode request:"),
        ("'[WS] 收到外部切号Request:", "'[WS] Received external account switch request:"),
        ("`[WS] 未知Message类型: ${message.type}`", "`[WS] Unknown message type: ${message.type}`"),
        ("'[WS] 解析MessageFailed:'", "'[WS] Failed to parse message:'"),
        ("`[WS] ${delay / 1000}秒后重连... (Failed次数: ${this.reconnectFailCount})`",
         "`[WS] Reconnecting in ${delay / 1000}s... (fail count: ${this.reconnectFailCount})`"),
        ("'Connection已关闭'", "'Connection closed'"),
    ],
    'src/services/syncSettings.ts': [
        ("'[SyncSettings] 读取SyncConfigurationFailed, 返回空Configuration:'",
         "'[SyncSettings] Failed to read sync configuration, returning empty config:'"),
        ("`[SyncSettings] 写入离线Configuration: ${key} = ${value}`",
         "`[SyncSettings] Writing offline config: ${key} = ${value}`"),
        ("'[SyncSettings] 写入SyncConfigurationFailed:'", "'[SyncSettings] Failed to write sync configuration:'"),
        ("`[SyncSettings] 清除已SyncConfiguration: ${key}`",
         "`[SyncSettings] Cleared synced configuration: ${key}`"),
        ("'[SyncSettings] 清除SyncConfigurationFailed:'", "'[SyncSettings] Failed to clear sync configuration:'"),
        ('`[SyncSettings] 合并Configuration ${key}: 共享File "${syncSetting.value}" > 本地 "${localValue}"`',
         '`[SyncSettings] Merged config ${key}: shared "${syncSetting.value}" > local "${localValue}"`'),
    ],
    'src/controller/message_controller.ts': [
        ("logger.warn(`[WS] Sync语言到桌面端Failed: ${syncResult.message}`)",
         "logger.warn(`[WS] Failed to sync language to desktop: ${syncResult.message}`)"),
        ("logger.info(`[SyncSettings] 语言写入共享File（离线模式）: ${languageForSync}`)",
         "logger.info(`[SyncSettings] Writing language to shared file (offline mode): ${languageForSync}`)"),
        ("? `已无感切换登录Account至 ${execution.toEmail}`",
         "? `Seamlessly switched login account to ${execution.toEmail}`"),
        ("t('autoTrigger.switchLoginFailed') || '切换登录AccountFailed'",
         "t('autoTrigger.switchLoginFailed') || 'Switch login account failed'"),
        ("`In progress切换到 ${email}...`", "`Switching to ${email}...`"),
        ("? `已无感切换到 ${switchedEmail}`", "? `Seamlessly switched to ${switchedEmail}`"),
        ("`当前Account标识已切换为 ${switchedEmail}`",
         "`Current account marker switched to ${switchedEmail}`"),
        ("`已Skipped ${result.skipped.length} 个InvalidAccount`",
         "`Skipped ${result.skipped.length} invalid accounts`"),
        ("'当前AccountImportFailed，已Skipped切换'",
         "'Current account import failed, skipping switch'"),
        ("t('antigravityToolsSync.noClientAccount') || '未检测到客户端登录Account'",
         "t('antigravityToolsSync.noClientAccount') || 'No client login account detected'"),
        ("`切换Failed: ${err}`", "`Switch failed: ${err}`"),
        ("const failedMessage = t('autoTrigger.switchLoginFailed') || '切换登录AccountFailed'",
         "const failedMessage = t('autoTrigger.switchLoginFailed') || 'Switch login account failed'"),
        ("t('antigravityToolsSync.switchFailed', { message: err }) || `切换Failed: ${err}`",
         "t('antigravityToolsSync.switchFailed', { message: err }) || `Switch failed: ${err}`"),
        (": `已无感切换登录Account至 ${execution.toEmail}`",
         ": `Seamlessly switched login account to ${execution.toEmail}`"),
        ("已切换登录Account至", "Switched login account to"),
    ],
}

def apply_replacements(filepath, pairs):
    full_path = os.path.join(BASE, filepath.replace('/', os.sep))
    if not os.path.exists(full_path):
        print(f'SKIP (not found): {filepath}')
        return
    with open(full_path, encoding='utf-8') as f:
        content = f.read()
    changed = False
    for old, new in pairs:
        if old in content:
            content = content.replace(old, new)
            changed = True
        else:
            print(f'  NOTFOUND in {filepath}: {old[:60]}')
    if changed:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'  modified: {filepath}')

for filepath, pairs in REPLACEMENTS.items():
    apply_replacements(filepath, pairs)

print('Done.')
