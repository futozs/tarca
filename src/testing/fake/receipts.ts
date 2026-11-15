import { finalizeFakeDraft, issueFakeDocument } from './documents'
import type { FakeRoutes } from './http'

export const receiptRoutes: FakeRoutes = {
  CreateReceipt: (state, request) => issueFakeDocument(state, request.body, 'receipt'),
  CreateReceiptFromDraft: (state, request) => finalizeFakeDraft(state, request, 'receipt'),
}
