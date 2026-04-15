#!/usr/bin/env node

const base = process.env.API_BASE || 'http://127.0.0.1:8791'

async function req(path, init = {}) {
  const r = await fetch(`${base}${path}`, init)
  const text = await r.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { ok: r.ok, status: r.status, body }
}

function ensure(ok, message, details) {
  if (!ok) {
    const err = new Error(message)
    err.details = details
    throw err
  }
}

async function main() {
  const login = await req('/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'commerce-smoke' }),
  })
  ensure(login.ok, 'guest login failed', login)
  const token = String(login.body?.token || '')
  ensure(Boolean(token), 'guest token missing', login)

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const createProduct = await req('/products', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      title: 'Smoke Product',
      currency: 'CNY',
      priceCents: 1200,
      stock: 3,
      status: 'active',
    }),
  })
  ensure(createProduct.ok, 'create product failed', createProduct)
  const productId = String(createProduct.body?.id || '')
  ensure(Boolean(productId), 'product id missing', createProduct)

  const createOrder = await req('/orders', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      items: [{ productId, quantity: 1 }],
    }),
  })
  ensure(createOrder.ok, 'create order failed', createOrder)
  const orderId = String(createOrder.body?.id || '')
  ensure(Boolean(orderId), 'order id missing', createOrder)

  // WeChat create should fail clearly when env is missing.
  const pay = await req('/wechat-pay/native/create', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ orderId }),
  })
  if (!pay.ok) {
    console.log('[SMOKE] expected pay failure without wechat env:', pay.body)
  } else {
    console.log('[SMOKE] pay create succeeded:', pay.body)
  }

  const cancelOrder = await req(`/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ reason: 'smoke_cancel' }),
  })
  ensure(cancelOrder.ok, 'cancel order failed', cancelOrder)
  ensure(cancelOrder.body?.status === 'canceled', 'order status mismatch after cancel', cancelOrder)

  const getProduct = await req(`/products/${encodeURIComponent(productId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  ensure(getProduct.ok, 'fetch product failed', getProduct)
  ensure(Number(getProduct.body?.stock) === 3, 'stock rollback failed after cancel', getProduct)

  console.log('[SMOKE] pass', { productId, orderId, orderNo: createOrder.body?.orderNo })
}

main().catch((err) => {
  console.error('[SMOKE] fail', err?.message || err)
  if (err?.details) console.error(JSON.stringify(err.details, null, 2))
  process.exit(1)
})
