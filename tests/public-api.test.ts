import { expect, test } from 'vitest'
import * as batch from '../src/batch/index'
import * as api from '../src/index'
import * as journal from '../src/journal/index'
import * as mcp from '../src/mcp/index'
import * as node from '../src/node/index'
import * as observe from '../src/observe/index'
import * as paymentsBarion from '../src/payments/barion'
import * as payments from '../src/payments/index'
import * as paymentsPaypal from '../src/payments/paypal'
import * as paymentsRevolut from '../src/payments/revolut'
import * as paymentsSimplepay from '../src/payments/simplepay'
import * as paymentsStripe from '../src/payments/stripe'
import * as storageFs from '../src/storage/fs'
import * as storage from '../src/storage/index'
import * as stores from '../src/stores/index'
import * as testing from '../src/testing/index'

test('a csomag nyilvános futásidejű exportjai', () => {
  expect(Object.keys(api).sort()).toEqual([
    'BILLINGO_API_URL',
    'BILLINGO_OPERATIONS',
    'BillingoError',
    'DEFAULT_TIMEOUT_MS',
    'DocumentHookError',
    'MAX_ATTEMPTS',
    'MAX_PER_PAGE',
    'TARCA_VERSION',
    'addBudapestDays',
    'createTarca',
    'isBillingoError',
    'isDocumentHookError',
    'nullIfNotFound',
    'toBillingoDate',
    'toBudapestDate',
    'toBudapestTimestamp',
    'todayInBudapest',
  ])
})

test('a tarca/testing nyilvános futásidejű exportjai', () => {
  expect(Object.keys(testing).sort()).toEqual([
    'FAKE_BILLINGO_MESSAGES',
    'createFakeBillingoFetch',
    'createMockTarca',
  ])
})

test('a tarca/node nyilvános futásidejű exportjai', () => {
  expect(Object.keys(node).sort()).toEqual([
    'NodeBodyError',
    'toNodeHandler',
    'toWebRequest',
    'writeWebResponse',
  ])
})

test('a tarca/batch nyilvános futásidejű exportjai', () => {
  expect(Object.keys(batch).sort()).toEqual([
    'DEFAULT_BATCH_RATE_PER_MINUTE',
    'MAX_BATCH_CONCURRENCY',
    'MAX_BATCH_RATE_PER_MINUTE',
    'billingPeriod',
    'billingPeriodAt',
    'billingPeriodsBetween',
    'runBatch',
    'todayPeriod',
  ])
})

test('a tarca/observe nyilvános futásidejű exportjai', () => {
  expect(Object.keys(observe).sort()).toEqual([
    'DEFAULT_DURATION_BUCKETS_MS',
    'MAX_OPEN_SPANS',
    'METRIC_HELP',
    'SPAN_KIND_CLIENT',
    'SPAN_STATUS_ERROR',
    'SPAN_STATUS_OK',
    'combineHooks',
    'createMetricsRegistry',
    'observe',
  ])
})

test('a tarca/storage nyilvános futásidejű exportjai', () => {
  expect(Object.keys(storage).sort()).toEqual([
    'INVOICE_KEY_FOLDER',
    'PDF_CONTENT_TYPE',
    'RECEIPT_KEY_FOLDER',
    'S3_MAX_PRESIGN_SECONDS',
    'SUPABASE_MAX_SIGNED_URL_SECONDS',
    'StorageError',
    'UPLOADTHING_MAX_CUSTOM_ID_LENGTH',
    'UPLOADTHING_MAX_SIGNED_URL_SECONDS',
    'assertStorageKey',
    'documentPdfKey',
    'guardStorageCall',
    'isPdf',
    'isStorageError',
    'memoryStorage',
    'presignAwsUrl',
    'r2BindingStorage',
    's3FetchStorage',
    's3Storage',
    'sanitizeKeySegment',
    'signAwsRequest',
    'storeDocumentPdf',
    'storePdf',
    'supabaseStorage',
    'uploadthingStorage',
    'vercelBlobStorage',
  ])
})

test('a tarca/storage/fs nyilvános futásidejű exportjai', () => {
  expect(Object.keys(storageFs).sort()).toEqual(['fsStorage'])
})

test('a tarca/stores nyilvános futásidejű exportjai', () => {
  expect(Object.keys(stores).sort()).toEqual([
    'CLOUDFLARE_KV_MIN_TTL_SECONDS',
    'DIAGNOSE_KEY_PREFIX',
    'DURABLE_OBJECT_STORE_URL',
    'cloudflareKvStore',
    'customStore',
    'diagnoseStore',
    'durableObjectStore',
    'handleDurableObjectStoreRequest',
    'ioredisStore',
    'memoryStore',
    'nodeRedisStore',
    'resilientStore',
    'storeCapabilities',
    'upstashRedisStore',
  ])
})

test('a tarca/journal nyilvános futásidejű exportjai', () => {
  expect(Object.keys(journal).sort()).toEqual([
    'DEFAULT_JOURNAL_RETENTION_DAYS',
    'DEFAULT_PENDING_DAYS',
    'DEFAULT_RECONCILE_GRACE_SECONDS',
    'DEFAULT_RESERVATION_TTL_DAYS',
    'JOURNAL_KEY_PREFIX',
    'JournalWriteError',
    'MAX_JOURNAL_RANGE_DAYS',
    'createJournal',
    'isJournalWriteError',
    'kvJournal',
    'memoryJournal',
  ])
})

test('a tarca/mcp nyilvános futásidejű exportjai', () => {
  expect(Object.keys(mcp).sort()).toEqual([
    'DEFAULT_CONFIRMATION_TTL_MS',
    'DEFAULT_MAX_BODY_BYTES',
    'MCP_LEGACY_VERSIONS',
    'MCP_MODERN_VERSIONS',
    'MCP_SUPPORTED_VERSIONS',
    'ToolInputError',
    'canonicalJson',
    'createConfirmations',
    'createTarcaMcpHandler',
    'createTarcaMcpServer',
    'profileFindings',
    'summarizeProfile',
  ])
})

test('a tarca/payments nyilvános futásidejű exportjai', () => {
  expect(Object.keys(payments).sort()).toEqual([
    'DEFAULT_DEDUPE_TTL_SECONDS',
    'DEFAULT_MAX_WEBHOOK_BYTES',
    'PaymentProviderError',
    'RECEIPT_MAX_GROSS_HUF',
    'REFUND_LEDGER_KEY_PREFIX',
    'REFUND_LEDGER_TTL_SECONDS',
    'WEBHOOK_DEDUPE_KEY_PREFIX',
    'WebhookVerificationError',
    'allocateRefund',
    'chooseDocument',
    'createModificationOnce',
    'currencyExponent',
    'deliverPayment',
    'fromMinorUnits',
    'hungarianTaxNumber',
    'isBillingoCurrency',
    'isPaymentProviderError',
    'isWebhookVerificationError',
    'issueForPayment',
    'normalizeCurrency',
    'parseDecimalAmount',
    'partnerFromCustomer',
    'paymentVendorId',
    'readRawBody',
    'refundLedgerKey',
    'refundMarker',
    'respondToWebhook',
    'webhookDedupeKey',
  ])
})

test('a tarca/payments/stripe nyilvános futásidejű exportjai', () => {
  expect(Object.keys(paymentsStripe).sort()).toEqual([
    'STRIPE_API_URL',
    'STRIPE_DEFAULT_TOLERANCE_SECONDS',
    'STRIPE_SHIPPING_ITEM_NAME',
    'countStripeRefunds',
    'fetchStripeLineItems',
    'findStripeCheckoutSession',
    'parseStripeEvent',
    'parseStripeSignatureHeader',
    'stripePaymentEvent',
    'stripeWebhook',
    'verifyStripeSignature',
  ])
})

test('a tarca/payments/simplepay nyilvános futásidejű exportjai', () => {
  expect(Object.keys(paymentsSimplepay).sort()).toEqual([
    'SIMPLEPAY_LIVE_API_URL',
    'SIMPLEPAY_SANDBOX_API_URL',
    'SIMPLEPAY_SDK_VERSION',
    'parseSimplePayIpn',
    'querySimplePayTransaction',
    'simplePayIpnResponse',
    'simplePayPaymentEvent',
    'simplePayRequest',
    'simplePaySignature',
    'simplePayWebhook',
    'verifySimplePayRedirect',
    'verifySimplePaySignature',
  ])
})

test('a tarca/payments/barion nyilvános futásidejű exportjai', () => {
  expect(Object.keys(paymentsBarion).sort()).toEqual([
    'BARION_LIVE_API_URL',
    'BARION_SANDBOX_API_URL',
    'barionPaymentEvent',
    'barionPaymentId',
    'barionWebhook',
    'fetchBarionPaymentState',
  ])
})

test('a tarca/payments/revolut nyilvános futásidejű exportjai', () => {
  expect(Object.keys(paymentsRevolut).sort()).toEqual([
    'REVOLUT_API_VERSION',
    'REVOLUT_DEFAULT_TOLERANCE_MS',
    'REVOLUT_LIVE_API_URL',
    'REVOLUT_SANDBOX_API_URL',
    'fetchRevolutOrder',
    'parseRevolutEvent',
    'revolutPaymentEvent',
    'revolutWebhook',
    'verifyRevolutSignature',
  ])
})

test('a tarca/payments/paypal nyilvános futásidejű exportjai', () => {
  expect(Object.keys(paymentsPaypal).sort()).toEqual([
    'PAYPAL_HANDLING_ITEM_NAME',
    'PAYPAL_INSURANCE_ITEM_NAME',
    'PAYPAL_LIVE_API_URL',
    'PAYPAL_SANDBOX_API_URL',
    'PAYPAL_SHIPPING_ITEM_NAME',
    'parsePayPalEvent',
    'payPalApi',
    'payPalCaptureIdOfRefund',
    'payPalOrderIdOfCapture',
    'payPalPaymentEvent',
    'payPalTransmission',
    'payPalWebhook',
    'verifyPayPalWebhook',
  ])
})
