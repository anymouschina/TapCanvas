import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import FormData from 'form-data'
import { createReadStream } from 'fs'

const OFFICIAL_SORA_BASE = 'https://sora.chatgpt.com'

type UploadResult = { status: number; data: any; baseUrl: string }

@Injectable()
export class SoraUploadProxyService {
  private readonly logger = new Logger(SoraUploadProxyService.name)

  async uploadFilePassthrough(params: {
    authHeader: string
    file: any
    useCase?: string
  }): Promise<UploadResult> {
    const baseUrl = this.resolveBaseUrl()
    const useCase = params.useCase?.trim() || 'profile'
    const baseIsOfficial = this.isOfficialBase(baseUrl)

    const attemptUpload = async (targetBase: string): Promise<UploadResult> => {
      const form = this.buildForm(params.file, useCase)
      const url = new URL('/backend/project_y/file/upload', targetBase).toString()
      const response = await axios.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: params.authHeader,
          Accept: 'application/json',
        },
        maxBodyLength: Infinity,
        validateStatus: () => true,
      })
      return { status: response.status, data: response.data, baseUrl: targetBase }
    }

    try {
      const first = await attemptUpload(baseUrl)
      if (first.status >= 200 && first.status < 300) {
        return first
      }
      if (!baseIsOfficial) {
        this.logger.warn('Custom Sora upload returned non-2xx, retrying official domain', {
          baseUrl,
          status: first.status,
        })
        return await attemptUpload(OFFICIAL_SORA_BASE)
      }
      return first
    } catch (err: any) {
      if (!baseIsOfficial) {
        this.logger.warn('Custom Sora upload failed, retrying official domain', {
          baseUrl,
          message: err?.message,
        })
        try {
          return await attemptUpload(OFFICIAL_SORA_BASE)
        } catch (fallbackError: any) {
          throw this.normalizeNetworkError(fallbackError)
        }
      }
      throw this.normalizeNetworkError(err)
    }
  }

  private buildForm(file: any, useCase: string): FormData {
    const payload = this.resolveUploadPayload(file)
    const form = new FormData()
    form.append('file', payload.source, {
      filename: payload.filename,
      contentType: payload.contentType,
    })
    form.append('use_case', useCase)
    return form
  }

  private resolveUploadPayload(
    file: any,
  ): { source: Buffer | NodeJS.ReadableStream; filename: string; contentType: string } {
    const filename =
      (typeof file?.originalname === 'string' && file.originalname.trim().length > 0
        ? file.originalname
        : 'upload.bin') || 'upload.bin'
    const contentType =
      (typeof file?.mimetype === 'string' && file.mimetype.trim().length > 0
        ? file.mimetype
        : 'application/octet-stream')

    if (file?.buffer && (file.buffer.length || file.buffer.byteLength)) {
      const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer)
      return { source: buffer, filename, contentType }
    }
    if (file?.path) {
      return { source: createReadStream(file.path), filename, contentType }
    }
    if (file?.stream) {
      return { source: file.stream, filename, contentType }
    }
    throw new Error('uploaded file buffer is empty')
  }

  private resolveBaseUrl(): string {
    const env = process.env.SORA_BASE_URL && process.env.SORA_BASE_URL.trim()
    return env || OFFICIAL_SORA_BASE
  }

  private isOfficialBase(baseUrl: string): boolean {
    try {
      const parsed = new URL(baseUrl)
      const official = new URL(OFFICIAL_SORA_BASE)
      return parsed.host === official.host
    } catch {
      return false
    }
  }

  private normalizeNetworkError(err: any): HttpException {
    const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
    const message =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      'Sora upload request failed'
    return new HttpException(
      {
        message,
        upstreamStatus: err?.response?.status ?? null,
        upstreamData: err?.response?.data ?? null,
      },
      status,
    )
  }
}
