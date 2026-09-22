/** Desktop denies browser clipboard permissions; use its trusted native bridge. */
export async function copyText(text: string): Promise<void> {
    if (window.directorDesktop?.copyText) {
        const result = await window.directorDesktop.copyText(text);
        if (!result.ok) throw new Error(result.error || '复制失败');
    } else await navigator.clipboard.writeText(text);
}
