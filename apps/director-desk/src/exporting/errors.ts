export function exportErrorMessage(error: unknown): string {
    const name = (error as Error)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError')
        return '无法写入所选文件：文件写入权限未获允许或已失效。请重新选择保存位置，或改用默认导出目录／下载视频。';
    if (name === 'NoModificationAllowedError') return '所选文件正在被其他程序使用，无法写入。请关闭占用程序或使用新的文件名。';
    if (name === 'NotFoundError') return '保存位置已不存在或无法访问，请重新选择文件夹。';
    return error instanceof Error ? error.message : String(error);
}
