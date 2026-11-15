export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type SpecPresence = 'both' | 'only-3.0.14' | 'only-3.0.15' | 'undocumented'

export interface OperationInfo {
  readonly method: HttpMethod
  readonly path: string
  readonly spec: SpecPresence
}

export type OperationId =
  | 'ListBankAccount'
  | 'CreateBankAccount'
  | 'GetBankAccount'
  | 'UpdateBankAccount'
  | 'DeleteBankAccount'
  | 'GetConversionRate'
  | 'ListDocumentBlock'
  | 'CreateDocumentBlock'
  | 'GetDocumentBlock'
  | 'UpdateDocumentBlock'
  | 'Create'
  | 'Download'
  | 'Poll'
  | 'ListDocument'
  | 'CreateDocument'
  | 'CreateReceipt'
  | 'CreateReceiptFromDraft'
  | 'GetDocumentByVendorId'
  | 'GetDocument'
  | 'CreateDocumentFromDraft'
  | 'DeleteDocument'
  | 'ArchiveDocument'
  | 'CancelDocument'
  | 'DocumentCopy'
  | 'CreateDocumentFromProforma'
  | 'CreateModificationDocument'
  | 'DownloadDocument'
  | 'GetOnlineSzamlaStatus'
  | 'GetPayment'
  | 'UpdatePayment'
  | 'DeletePayment'
  | 'PosPrint'
  | 'GetPublicUrl'
  | 'GetDocumentReminderEventList'
  | 'SendDocument'
  | 'GetProductQuantity'
  | 'GetOrganizationData'
  | 'ListPartner'
  | 'CreatePartner'
  | 'PartnerGuess'
  | 'GetPartner'
  | 'UpdatePartner'
  | 'DeletePartner'
  | 'ListProduct'
  | 'CreateProduct'
  | 'GetProduct'
  | 'UpdateProduct'
  | 'DeleteProduct'
  | 'SpendingList'
  | 'SpendingSave'
  | 'SpendingShow'
  | 'SpendingUpdate'
  | 'SpendingDelete'
  | 'CheckTaxNumber'
  | 'GetId'
  | 'GetServerTime'

export const BILLINGO_OPERATIONS: Readonly<Record<OperationId, OperationInfo>> = {
  ListBankAccount: { method: 'GET', path: '/bank-accounts', spec: 'both' },
  CreateBankAccount: { method: 'POST', path: '/bank-accounts', spec: 'both' },
  GetBankAccount: { method: 'GET', path: '/bank-accounts/{id}', spec: 'both' },
  UpdateBankAccount: { method: 'PUT', path: '/bank-accounts/{id}', spec: 'both' },
  DeleteBankAccount: { method: 'DELETE', path: '/bank-accounts/{id}', spec: 'both' },
  GetConversionRate: { method: 'GET', path: '/currencies', spec: 'both' },
  ListDocumentBlock: { method: 'GET', path: '/document-blocks', spec: 'both' },
  CreateDocumentBlock: { method: 'POST', path: '/document-blocks', spec: 'only-3.0.15' },
  GetDocumentBlock: { method: 'GET', path: '/document-blocks/{id}', spec: 'undocumented' },
  UpdateDocumentBlock: { method: 'PUT', path: '/document-blocks/{id}', spec: 'undocumented' },
  Create: { method: 'POST', path: '/document-export', spec: 'both' },
  Download: { method: 'GET', path: '/document-export/{id}/download', spec: 'both' },
  Poll: { method: 'GET', path: '/document-export/{id}/poll', spec: 'both' },
  ListDocument: { method: 'GET', path: '/documents', spec: 'both' },
  CreateDocument: { method: 'POST', path: '/documents', spec: 'both' },
  CreateReceipt: { method: 'POST', path: '/documents/receipt', spec: 'both' },
  CreateReceiptFromDraft: { method: 'PUT', path: '/documents/receipt/{id}', spec: 'both' },
  GetDocumentByVendorId: { method: 'GET', path: '/documents/vendor/{vendor_id}', spec: 'both' },
  GetDocument: { method: 'GET', path: '/documents/{id}', spec: 'both' },
  CreateDocumentFromDraft: { method: 'PUT', path: '/documents/{id}', spec: 'both' },
  DeleteDocument: { method: 'DELETE', path: '/documents/{id}', spec: 'both' },
  ArchiveDocument: { method: 'PUT', path: '/documents/{id}/archive', spec: 'both' },
  CancelDocument: { method: 'POST', path: '/documents/{id}/cancel', spec: 'both' },
  DocumentCopy: { method: 'POST', path: '/documents/{id}/copy', spec: 'both' },
  CreateDocumentFromProforma: {
    method: 'POST',
    path: '/documents/{id}/create-from-proforma',
    spec: 'both',
  },
  CreateModificationDocument: {
    method: 'POST',
    path: '/documents/{id}/create-modification-document',
    spec: 'both',
  },
  DownloadDocument: { method: 'GET', path: '/documents/{id}/download', spec: 'both' },
  GetOnlineSzamlaStatus: { method: 'GET', path: '/documents/{id}/online-szamla', spec: 'both' },
  GetPayment: { method: 'GET', path: '/documents/{id}/payments', spec: 'both' },
  UpdatePayment: { method: 'PUT', path: '/documents/{id}/payments', spec: 'both' },
  DeletePayment: { method: 'DELETE', path: '/documents/{id}/payments', spec: 'both' },
  PosPrint: { method: 'GET', path: '/documents/{id}/print/pos', spec: 'both' },
  GetPublicUrl: { method: 'GET', path: '/documents/{id}/public-url', spec: 'both' },
  GetDocumentReminderEventList: {
    method: 'GET',
    path: '/documents/{id}/reminders',
    spec: 'only-3.0.15',
  },
  SendDocument: { method: 'POST', path: '/documents/{id}/send', spec: 'both' },
  GetProductQuantity: {
    method: 'GET',
    path: '/inventory/product/{id}/quantity',
    spec: 'only-3.0.15',
  },
  GetOrganizationData: { method: 'GET', path: '/organization', spec: 'both' },
  ListPartner: { method: 'GET', path: '/partners', spec: 'both' },
  CreatePartner: { method: 'POST', path: '/partners', spec: 'both' },
  PartnerGuess: { method: 'POST', path: '/partners/guess', spec: 'only-3.0.15' },
  GetPartner: { method: 'GET', path: '/partners/{id}', spec: 'only-3.0.14' },
  UpdatePartner: { method: 'PUT', path: '/partners/{id}', spec: 'only-3.0.14' },
  DeletePartner: { method: 'DELETE', path: '/partners/{id}', spec: 'only-3.0.14' },
  ListProduct: { method: 'GET', path: '/products', spec: 'both' },
  CreateProduct: { method: 'POST', path: '/products', spec: 'both' },
  GetProduct: { method: 'GET', path: '/products/{id}', spec: 'both' },
  UpdateProduct: { method: 'PUT', path: '/products/{id}', spec: 'both' },
  DeleteProduct: { method: 'DELETE', path: '/products/{id}', spec: 'both' },
  SpendingList: { method: 'GET', path: '/spendings', spec: 'both' },
  SpendingSave: { method: 'POST', path: '/spendings', spec: 'both' },
  SpendingShow: { method: 'GET', path: '/spendings/{id}', spec: 'both' },
  SpendingUpdate: { method: 'PUT', path: '/spendings/{id}', spec: 'both' },
  SpendingDelete: { method: 'DELETE', path: '/spendings/{id}', spec: 'both' },
  CheckTaxNumber: { method: 'GET', path: '/utils/check-tax-number/{tax_number}', spec: 'both' },
  GetId: { method: 'GET', path: '/utils/convert-legacy-id/{id}', spec: 'both' },
  GetServerTime: { method: 'GET', path: '/utils/time', spec: 'both' },
}

export function operationInfo(operation: OperationId): OperationInfo {
  return BILLINGO_OPERATIONS[operation]
}
