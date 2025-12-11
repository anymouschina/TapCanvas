// @ts-ignore
import BFM from 'browser-md5-file';

/**
 * 将 base64 数据转换为 File 对象
 * @param base64 base64 数据
 * @param filename 文件名
 * @param mimeType 文件类型
 * @returns File 对象
 */
export function base64ToFile(base64: string, filename: string, mimeType: string): File {
  const arr = base64.split(',');
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], filename, { type: mimeType });
}

/**
 * 将 Blob 对象转换为 base64 数据 URL
 * @param blob Blob 对象
 * @returns base64 数据 URL
 */
export function blobToBase64DataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 将 File 对象转换为 base64 数据 URL
 * @param file File 对象
 * @returns base64 数据 URL
 */
export function fileToBase64DataURL(file: File): Promise<string> {
  return blobToBase64DataURL(file);
}

/**
 * 下载文件，优先使用showSaveFilePicker API，支持Blob和ReadableStream
 * @param data Blob或ReadableStream对象
 * @param filename 文件名
 * @param type 文件类型
 * @returns Promise<boolean> 下载是否成功
 */
export async function downloadBlob(data: Blob | ReadableStream<Uint8Array>, filename: string, type?: string) {
    // 检查是否支持showSaveFilePicker
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            // 提取文件扩展名和MIME类型
            const ext = filename.split('.').pop() || 'bin';
            const mimeType = data instanceof Blob && data.type ? data.type : type || `application/${ext}`;

            // 使用showSaveFilePicker获取文件句柄
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: '文件',
                    accept: { [mimeType]: [`.${ext}`] } as Record<string, `.${string}`[]>
                }]
            });

            // 创建可写流
            const writable = await fileHandle.createWritable();

            if (data instanceof Blob) {
                // 如果是Blob，先转换为ReadableStream
                const readable = data.stream();
                await readable.pipeTo(writable, { preventClose: true });
            } else {
                // 如果已经是ReadableStream，直接管道
                await data.pipeTo(writable, { preventClose: true });
            }

            await writable.close();
            return;
        } catch (error) {}
    }

    // 回退到传统方式
    const blob = data instanceof Blob ? data : await new Response(data).blob();
    const URL = (window.URL || window.webkitURL);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 10000);
}


export function getFileMd5(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        new BFM().md5(file, (err: Error, md5: string) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(md5);
        });
    });
}

export function blobToFile(blob: Blob, fileName: string) {
    return new File([blob], fileName, { type: blob.type });
}
