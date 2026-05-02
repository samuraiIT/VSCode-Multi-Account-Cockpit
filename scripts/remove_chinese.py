#!/usr/bin/env python3
"""Remove Chinese characters from TypeScript/JS source files."""
import os
import re
import sys

CHINESE_RE = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef\u3000-\u303f]')

def has_chinese(text):
    return bool(CHINESE_RE.search(text))

# Common Chinese error/message strings -> English translations
TRANSLATIONS = {
    '未找到 Antigravity Tools 当前账号': 'Antigravity Tools current account not found',
    '用户取消': 'User cancelled',
    '验证超时，已跳过': 'Verification timed out, skipped',
    '未找到有效账号': 'No valid account found',
    'JSON 为空': 'JSON is empty',
    'JSON 解析失败': 'JSON parse failed',
    'JSON 必须是数组': 'JSON must be an array',
    '条目格式无效': 'Invalid entry format',
    '版本不匹配': 'Version mismatch',
    '目标版本范围': 'Target version range',
    '目标语言列表': 'Target language list',
    '留空表示所有语言': 'empty means all languages',
    '表示所有': 'means all',
    '未读公告 ID 列表': 'Unread announcement ID list',
    '操作类型': 'Action type',
    '命令参数': 'Command arguments',
    '仅 type=': 'only type=',
    '时有效': ' is valid',
    '图片 URL': 'Image URL',
    '图片标签': 'Image label',
    '微信群': 'WeChat group',
    'QQ 群': 'QQ group',
    '图片替代文字': 'Image alt text',
    '唯一标识': 'Unique identifier',
    '优先级': 'Priority',
    '数值越大越优先': 'higher value = higher priority',
    '简短摘要': 'Short summary',
    '列表展示用': 'for list display',
    '完整内容': 'Full content',
    '操作按钮': 'Action buttons',
    '可选': 'optional',
    '操作覆盖': 'Action overrides',
    '是否仅显示一次': 'Show only once',
    '标记已读后不再弹': 'no re-display after marked as read',
    '是否主动弹框': 'Auto-popup',
    '创建时间': 'Creation time',
    '过期时间': 'Expiry time',
    '版本范围': 'Version range',
    '覆盖操作': 'Override actions',
    '按钮文字': 'Button label',
    '目标（Tab ID / URL / 命令 ID）': 'Target (Tab ID / URL / Command ID)',
    '公告类型': 'Announcement type',
    '公告操作类型': 'Announcement action type',
    '公告操作': 'Announcement action',
    '公告操作覆盖': 'Announcement action override',
    '公告多语言内容': 'Announcement multilingual content',
    '公告图片': 'Announcement image',
    '单条公告': 'Single announcement',
    '公告 API 响应': 'Announcement API response',
    '公告状态（传递给 Webview）': 'Announcement state (passed to Webview)',
    'AntigravityTools 当前账户是否已存在于 Cockpit 本地': 'Whether AntigravityTools current account already exists in Cockpit locally',
    '标题': 'Title',
    '跳过': 'Skipped',
    '取消': 'Cancel',
    '超时': 'Timeout',
    '失败': 'Failed',
    '成功': 'Success',
    '错误': 'Error',
    '已存在': 'Already exists',
    '不存在': 'Does not exist',
    '无效': 'Invalid',
    '有效': 'Valid',
    '开始': 'Start',
    '结束': 'End',
    '正在': 'In progress',
    '完成': 'Done',
    '请求': 'Request',
    '响应': 'Response',
    '加载': 'Loading',
    '保存': 'Saving',
    '删除': 'Deleting',
    '更新': 'Updating',
    '配置': 'Configuration',
    '初始化': 'Initializing',
    '连接': 'Connection',
    '断开': 'Disconnected',
    '已连接': 'Connected',
    '认证': 'Authentication',
    '授权': 'Authorization',
    '账号': 'Account',
    '账户': 'Account',
    '邮箱': 'Email',
    '密码': 'Password',
    '令牌': 'Token',
    '密钥': 'Key',
    '证书': 'Certificate',
    '文件': 'File',
    '目录': 'Directory',
    '路径': 'Path',
    '备份': 'Backup',
    '恢复': 'Restore',
    '同步': 'Sync',
    '导入': 'Import',
    '导出': 'Export',
    '刷新': 'Refresh',
    '重试': 'Retry',
    '状态': 'Status',
    '消息': 'Message',
    '通知': 'Notification',
    '警告': 'Warning',
    '信息': 'Information',
    '调试': 'Debug',
}

def translate_chinese(text):
    """Replace known Chinese phrases with English."""
    for zh, en in sorted(TRANSLATIONS.items(), key=lambda x: -len(x[0])):
        text = text.replace(zh, en)
    return text

def is_comment_line_with_chinese(line):
    """True if the line is a comment line (// or JSDoc * line) that has Chinese."""
    stripped = line.strip()
    if not has_chinese(stripped):
        return False
    if stripped.startswith('//'):
        return True
    if stripped.startswith('/**') and stripped.endswith('*/'):
        return True
    if stripped.startswith('*') and not stripped.startswith('*/'):
        return True
    return False

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()

    new_lines = []
    changed = False
    for line in lines:
        if not has_chinese(line):
            new_lines.append(line)
            continue

        # Remove comment lines that are purely comments with Chinese
        if is_comment_line_with_chinese(line):
            changed = True
            continue

        # For string literals and other code: translate known phrases
        translated = translate_chinese(line)
        if translated != line:
            line = translated
            changed = True

        # If Chinese still remains in the line after translation, just keep it
        # (safer than corrupting code)
        new_lines.append(line)

    if changed:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
        return True
    return False

def main():
    src_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src')
    processed = 0
    changed = 0
    errors = 0
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for fname in files:
            if not (fname.endswith('.ts') or fname.endswith('.js')):
                continue
            fpath = os.path.join(root, fname)
            try:
                processed += 1
                if process_file(fpath):
                    changed += 1
            except Exception as e:
                errors += 1
                print(f'  ERROR {fpath}: {e}', file=sys.stderr)

    print(f'Done: {processed} files processed, {changed} modified, {errors} errors')

if __name__ == '__main__':
    main()
