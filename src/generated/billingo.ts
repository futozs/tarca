export interface Address {
  readonly countryCode: Country
  readonly postCode: string
  readonly city: string
  readonly address: string
}

export interface BankAccount {
  readonly id?: number
  readonly name: string
  readonly accountNumber: string
  readonly accountNumberIban?: string
  readonly swift?: string
  readonly currency: Currency
  readonly needQr?: boolean
}

export interface BankAccountList {
  readonly data?: readonly BankAccount[]
  readonly total?: number
  readonly perPage?: number
  readonly currentPage?: number
  readonly lastPage?: number
  readonly prevPageUrl?: string
  readonly nextPageUrl?: string
}

export type Category =
  | 'accounting_and_auditing'
  | 'advertisement'
  | 'bonus'
  | 'business_insurance'
  | 'cleaning'
  | 'construction_and_repair'
  | 'consulting'
  | 'consumer_goods'
  | 'contractors'
  | 'development'
  | 'dividends'
  | 'donations'
  | 'duty_taxes'
  | 'education_and_trainings'
  | 'electricity'
  | 'electronics'
  | 'employee_benefits'
  | 'entertainment'
  | 'equipment_insurance'
  | 'federal_taxes'
  | 'fees'
  | 'financials'
  | 'fines'
  | 'gas'
  | 'gas_and_fuel'
  | 'health_insurance'
  | 'human_resources'
  | 'income'
  | 'income_taxes'
  | 'insurance'
  | 'interest'
  | 'internet'
  | 'investments'
  | 'leasing'
  | 'legal'
  | 'liability_insurance'
  | 'loans'
  | 'meals'
  | 'mortgage'
  | 'office_rent'
  | 'online_subscriptions'
  | 'other'
  | 'overheads'
  | 'payroll_taxes'
  | 'phone'
  | 'prepayments'
  | 'professional_insurance'
  | 'property_taxes'
  | 'real_estate'
  | 'returns'
  | 'sales'
  | 'service'
  | 'service_and_parts'
  | 'shipping'
  | 'software'
  | 'staff_outsourcing'
  | 'stock'
  | 'storage'
  | 'supplies_and_furniture'
  | 'tangible_assets'
  | 'tax_return'
  | 'taxes'
  | 'taxi'
  | 'transport'
  | 'travel'
  | 'utilities'
  | 'vat'
  | 'vehicle_insurance'
  | 'wages'
  | 'water'

export type CheckTaxNumberMessage =
  | 'external_nav_service_unreachable'
  | 'invalid_tax_number'
  | 'no_online_szamla_settings'
  | 'non_exist_tax_number'
  | 'postal_code_of_this_tax_number_is_invalid.'
  | 'validation_ok'

export interface ClientError {
  readonly message?: string
}

export interface ClientErrorResponse {
  readonly error?: ClientError
}

export interface ConnectDocumentItemSetting {
  readonly applyQuantity?: boolean
  readonly disableDiscount?: boolean
}

export interface ConnectedItem {
  readonly productId?: number
  readonly itemIndex?: number
}

export type ConsignmentStatus =
  | 'Cancelled'
  | 'Created'
  | 'Delivered'
  | 'DeliveredToManufacturing'
  | 'DeliveringError'
  | 'Enveloping'
  | 'EnvelopingFinished'
  | 'ManifacturingFinished'
  | 'ManufacturingFinished'
  | 'Opened'
  | 'Ordered'
  | 'OutputError'
  | 'Posted'
  | 'PrinterFileCreated'
  | 'Printing'
  | 'PrintingError'
  | 'PrintingFinished'
  | 'Processed'
  | 'ProcessingError'
  | 'Saved'
  | 'SendingError'
  | 'Sent'
  | 'ValidatedBySystem'
  | 'WaitForProcessing'
  | 'WrongAddress'

export interface ConversationRate {
  readonly fromCurrency?: Currency
  readonly toCurrency?: Currency
  readonly conversationRate?: number
  readonly date?: string
}

export type CorrectionType =
  | 'advance'
  | 'canceled'
  | 'cancellation'
  | 'cert_of_completion'
  | 'd_cert_of_completion'
  | 'dossier'
  | 'draft'
  | 'draft_offer'
  | 'draft_order_form'
  | 'draft_waybill'
  | 'invoice'
  | 'modification'
  | 'modified'
  | 'offer'
  | 'order_form'
  | 'proforma'
  | 'receipt'
  | 'receipt_cancellation'
  | 'waybill'

export type Country =
  | ''
  | 'AC'
  | 'AD'
  | 'AE'
  | 'AF'
  | 'AG'
  | 'AI'
  | 'AL'
  | 'AM'
  | 'AO'
  | 'AQ'
  | 'AR'
  | 'AS'
  | 'AT'
  | 'AU'
  | 'AW'
  | 'AX'
  | 'AZ'
  | 'BA'
  | 'BB'
  | 'BD'
  | 'BE'
  | 'BF'
  | 'BG'
  | 'BH'
  | 'BI'
  | 'BJ'
  | 'BL'
  | 'BM'
  | 'BN'
  | 'BO'
  | 'BQ'
  | 'BR'
  | 'BS'
  | 'BT'
  | 'BW'
  | 'BY'
  | 'BZ'
  | 'CA'
  | 'CC'
  | 'CD'
  | 'CF'
  | 'CG'
  | 'CH'
  | 'CI'
  | 'CK'
  | 'CL'
  | 'CM'
  | 'CN'
  | 'CO'
  | 'CR'
  | 'CU'
  | 'CV'
  | 'CW'
  | 'CX'
  | 'CY'
  | 'CZ'
  | 'DE'
  | 'DG'
  | 'DJ'
  | 'DK'
  | 'DM'
  | 'DO'
  | 'DZ'
  | 'EA'
  | 'EC'
  | 'EE'
  | 'EG'
  | 'EH'
  | 'ER'
  | 'ES'
  | 'ET'
  | 'FI'
  | 'FJ'
  | 'FK'
  | 'FM'
  | 'FO'
  | 'FR'
  | 'GA'
  | 'GB'
  | 'GD'
  | 'GE'
  | 'GF'
  | 'GG'
  | 'GH'
  | 'GI'
  | 'GL'
  | 'GM'
  | 'GN'
  | 'GP'
  | 'GQ'
  | 'GR'
  | 'GS'
  | 'GT'
  | 'GU'
  | 'GW'
  | 'GY'
  | 'HK'
  | 'HN'
  | 'HR'
  | 'HT'
  | 'HU'
  | 'IC'
  | 'ID'
  | 'IE'
  | 'IL'
  | 'IM'
  | 'IN'
  | 'IO'
  | 'IQ'
  | 'IR'
  | 'IS'
  | 'IT'
  | 'JE'
  | 'JM'
  | 'JO'
  | 'JP'
  | 'KE'
  | 'KG'
  | 'KH'
  | 'KI'
  | 'KM'
  | 'KN'
  | 'KP'
  | 'KR'
  | 'KW'
  | 'KY'
  | 'KZ'
  | 'LA'
  | 'LB'
  | 'LC'
  | 'LI'
  | 'LK'
  | 'LR'
  | 'LS'
  | 'LT'
  | 'LU'
  | 'LV'
  | 'LY'
  | 'MA'
  | 'MC'
  | 'MD'
  | 'ME'
  | 'MF'
  | 'MG'
  | 'MH'
  | 'MK'
  | 'ML'
  | 'MM'
  | 'MN'
  | 'MO'
  | 'MP'
  | 'MQ'
  | 'MR'
  | 'MS'
  | 'MT'
  | 'MU'
  | 'MV'
  | 'MW'
  | 'MX'
  | 'MY'
  | 'MZ'
  | 'NA'
  | 'NC'
  | 'NE'
  | 'NF'
  | 'NG'
  | 'NI'
  | 'NL'
  | 'NO'
  | 'NP'
  | 'NR'
  | 'NU'
  | 'NZ'
  | 'OM'
  | 'PA'
  | 'PE'
  | 'PF'
  | 'PG'
  | 'PH'
  | 'PK'
  | 'PL'
  | 'PM'
  | 'PN'
  | 'PR'
  | 'PS'
  | 'PT'
  | 'PW'
  | 'PY'
  | 'QA'
  | 'RE'
  | 'RO'
  | 'RS'
  | 'RU'
  | 'RW'
  | 'SA'
  | 'SB'
  | 'SC'
  | 'SD'
  | 'SE'
  | 'SG'
  | 'SH'
  | 'SI'
  | 'SJ'
  | 'SK'
  | 'SL'
  | 'SM'
  | 'SN'
  | 'SO'
  | 'SR'
  | 'SS'
  | 'ST'
  | 'SV'
  | 'SX'
  | 'SY'
  | 'SZ'
  | 'TA'
  | 'TC'
  | 'TD'
  | 'TF'
  | 'TG'
  | 'TH'
  | 'TJ'
  | 'TK'
  | 'TL'
  | 'TM'
  | 'TN'
  | 'TO'
  | 'TR'
  | 'TT'
  | 'TV'
  | 'TW'
  | 'TZ'
  | 'UA'
  | 'UG'
  | 'UM'
  | 'US'
  | 'UY'
  | 'UZ'
  | 'VA'
  | 'VC'
  | 'VE'
  | 'VG'
  | 'VI'
  | 'VN'
  | 'VU'
  | 'WF'
  | 'WS'
  | 'XA'
  | 'XB'
  | 'XK'
  | 'YE'
  | 'YT'
  | 'ZA'
  | 'ZM'
  | 'ZW'

export interface CreateDocumentExport {
  readonly queryType: DocumentExportQueryType
  readonly startDate: string
  readonly endDate: string
  readonly documentBlockId?: number
  readonly exportType: DocumentExportType
  readonly numberStartYear?: number
  readonly numberStartSequence?: number
  readonly numberEndYear?: number
  readonly numberEndSequence?: number
  readonly paymentMethod?: PaymentMethod
  readonly sortBy?: DocumentExportSortBy
  readonly otherOptions?: DocumentExportOtherOptions
  readonly filterExtra?: DocumentExportFilterExtra
}

export type Currency =
  | 'AED'
  | 'ALL'
  | 'AUD'
  | 'BGN'
  | 'BRL'
  | 'CAD'
  | 'CHF'
  | 'CNY'
  | 'COP'
  | 'CZK'
  | 'DKK'
  | 'EUR'
  | 'GBP'
  | 'GEL'
  | 'HKD'
  | 'HRK'
  | 'HUF'
  | 'IDR'
  | 'ILS'
  | 'INR'
  | 'ISK'
  | 'JPY'
  | 'KRW'
  | 'LEJ'
  | 'MKD'
  | 'MNT'
  | 'MXN'
  | 'MYR'
  | 'NOK'
  | 'NZD'
  | 'PHP'
  | 'PLN'
  | 'RON'
  | 'RSD'
  | 'RUB'
  | 'SEK'
  | 'SGD'
  | 'SKK'
  | 'THB'
  | 'TRY'
  | 'UAH'
  | 'USD'
  | 'ZAR'

export interface CustomLabel {
  readonly label?: string
  readonly isVisible?: boolean
}

export type DateType = 'due_date' | 'fulfillment_date' | 'invoice_date'

export interface Discount {
  readonly type?: DiscountType
  readonly value?: number
}

export type DiscountType = 'percent'

export interface Document {
  readonly id?: number
  readonly invoiceNumber?: string
  readonly type?: DocumentType
  readonly cancelled?: boolean
  readonly blockId?: number
  readonly paymentStatus?: PaymentStatus
  readonly paymentMethod?: PaymentMethod
  readonly grossTotal?: number
  readonly currency?: Currency
  readonly conversionRate?: number
  readonly invoiceDate?: string
  readonly fulfillmentDate?: string
  readonly dueDate?: string
  readonly paidDate?: string
  readonly organization?: DocumentOrganization
  readonly partner?: Partner
  readonly documentPartner?: DocumentPartner
  readonly electronic?: boolean
  readonly comment?: string
  readonly tags?: readonly string[]
  readonly notificationStatus?: DocumentNotificationStatus
  readonly language?: DocumentLanguage
  readonly items?: readonly DocumentItem[]
  readonly summary?: DocumentSummary
  readonly settings?: DocumentSettings
  readonly onlineSzamlaStatus?: OnlineSzamlaStatusEnum
  readonly kobakReceiptStatus?: KobakReceiptStatus | null
  readonly kobakReceiptMessage?: string | null
  readonly relatedDocuments?: readonly DocumentAncestor[]
  readonly discount?: Discount
  readonly correctionType?: CorrectionType
  readonly recurringId?: number
}

export interface DocumentAncestor {
  readonly id?: number
  readonly invoiceNumber?: string
}

export interface DocumentBankAccount {
  readonly id?: number | null
  readonly name: string
  readonly accountNumber: string
  readonly accountNumberIban?: string
  readonly swift?: string
}

export interface DocumentBlock {
  readonly id?: number
  readonly name?: string
  readonly prefix?: string
  readonly customField1?: string
  readonly customField2?: string
  readonly type?: DocumentBlockType
}

export interface DocumentBlockList {
  readonly data?: readonly DocumentBlock[]
  readonly total?: number
  readonly perPage?: number
  readonly currentPage?: number
  readonly lastPage?: number
  readonly prevPageUrl?: string
  readonly nextPageUrl?: string
}

export interface DocumentBlockSchema {
  readonly id?: number
  readonly name?: string
  readonly prefix?: string
  readonly type?: DocumentBlockType
  readonly customField1?: string | null
  readonly customField2?: string | null
  readonly templateId?: number
  readonly picPath?: string
  readonly normalNotificationId?: number
  readonly proformaNotificationId?: number
  readonly generated?: boolean
  readonly invoiceNumberFormat?: InvoiceNumberFormat
  readonly senderEmail?: string | null
  readonly senderName?: string
  readonly bccEmail?: string | null
  readonly createInvoiceFromPaidProforma?: boolean
  readonly fulfillmentDateFromProformaPaymentDate?: boolean
  readonly attachXmlToInvoicePdf?: boolean
  readonly advancePaidInstant?: boolean
  readonly financialFulfillmentHighlight?: FinancialFulfillmentHighlight
  readonly entitlementsInDocumentComment?: boolean
  readonly bankAccountId?: number
}

export type DocumentBlockType =
  | 'certificate_of_completion'
  | 'dossier'
  | 'invoice'
  | 'offer'
  | 'order_form'
  | 'receipt'
  | 'waybill'

export interface DocumentCancellation {
  readonly cancellationReason?: string
  readonly cancellationRecipients?: string
}

export interface DocumentExportFilterExtra {
  readonly tensoftVkod?: string
  readonly ledgerNumber?: LedgerNumberInformation
  readonly forintsoftKonyvelesiNaploSzam?: string
  readonly positiveLedgerNumber?: string
  readonly negativeLedgerNumber?: string
  readonly rlbKata?: boolean
  readonly rlbNote?: string
  readonly novitaxNaplokod?: string
  readonly useGrossValues?: boolean
}

export interface DocumentExportId {
  readonly id?: string
}

export type DocumentExportOtherOptions = 'all' | 'expired' | 'outstanding'

export type DocumentExportQueryType = 'due_date' | 'fulfillment_date' | 'invoice_date' | 'paid_date'

export type DocumentExportSortBy = 'fulfillment_date' | 'invoice_date' | 'invoice_raw_number'

export interface DocumentExportStatus {
  readonly id?: string
  readonly state?: DocumentExportStatusState
  readonly message?: string
}

export type DocumentExportStatusState = 'fail' | 'pending' | 'processing' | 'success' | 'warning'

export type DocumentExportType =
  | 'armada'
  | 'aws_batch'
  | 'ex_panda'
  | 'forintsoft'
  | 'hessyn'
  | 'ima'
  | 'infoteka'
  | 'kulcs_konyv'
  | 'maxitax'
  | 'nagy_machinator'
  | 'nav_ptgszlah'
  | 'nav_status'
  | 'nav_xml'
  | 'nav_xml_alias'
  | 'novitax'
  | 'proforma_outstanding'
  | 'relax'
  | 'rlb'
  | 'rlb60'
  | 'rlb_double_entry'
  | 'simple_csv'
  | 'simple_excel'
  | 'simple_excel_items'
  | 'tensoft'
  | 'tensoft_29_dot_65'
  | 'used_erase_code'

export type DocumentForm = 'electronic' | 'paper'

export type DocumentFormat = '' | 'electronic' | 'traditional'

export interface DocumentInsert {
  readonly vendorId?: string
  readonly partnerId: number
  readonly blockId: number
  readonly bankAccountId?: number
  readonly type: DocumentInsertType
  readonly fulfillmentDate: string
  readonly dueDate: string
  readonly paymentMethod: PaymentMethod
  readonly language: DocumentLanguage
  readonly currency: Currency
  readonly conversionRate?: number
  readonly electronic?: boolean
  readonly paid?: boolean
  readonly items?: readonly (DocumentItemData | DocumentProductData)[]
  readonly comment?: string
  readonly settings?: DocumentSettings
  readonly advanceInvoice?: readonly number[]
  readonly discount?: Discount
  readonly instantPayment?: boolean
  readonly instantPaymentRequest?: DocumentInstantPaymentRequest | null
}

export type DocumentInsertType = 'advance' | 'draft' | 'invoice' | 'proforma'

export interface DocumentInstantPaymentRequest {
  readonly debtorBankAccount?: string
  readonly differentAmountAllowed?: boolean
  readonly updatePartnerPaymentDetails?: boolean
}

export interface DocumentItem {
  readonly productId?: number | null
  readonly name?: string
  readonly netUnitAmount?: number
  readonly quantity?: number
  readonly unit?: string
  readonly netAmount?: number
  readonly grossAmount?: number
  readonly vat?: Vat
  readonly vatAmount?: number
  readonly entitlement?: Entitlement
  readonly comment?: string
  readonly sku?: string
  readonly dataEraserCodes?: string
  readonly isDepositFee?: boolean
  readonly ean?: string
  readonly isConnectProduct?: boolean
  readonly connectedItem?: ConnectedItem | null
  readonly connectDocumentItemSetting?: ConnectDocumentItemSetting | null
}

export interface DocumentItemData {
  readonly productId: number
  readonly quantity: number
  readonly comment?: string
}

export type DocumentLanguage = 'de' | 'en' | 'fr' | 'hr' | 'hu' | 'it' | 'ro' | 'sk' | 'us'

export interface DocumentList {
  readonly data?: readonly Document[]
  readonly total?: number
  readonly perPage?: number
  readonly currentPage?: number
  readonly lastPage?: number
  readonly prevPageUrl?: string
  readonly nextPageUrl?: string
}

export type DocumentNotificationStatus =
  | 'closed'
  | 'downloaded'
  | 'failed'
  | 'none'
  | 'opened'
  | 'readed'

export interface DocumentOrganization {
  readonly name?: string
  readonly taxNumber?: string
  readonly bankAccount?: DocumentBankAccount
  readonly address?: Address
  readonly smallTaxpayer?: boolean
  readonly evNumber?: string
  readonly euTaxNumber?: string
  readonly cashSettled?: boolean
}

export interface DocumentPartner {
  readonly id?: number
  readonly name?: string
  readonly address?: Address
  readonly emails?: readonly string[]
  readonly taxcode?: string
  readonly iban?: string
  readonly swift?: string
  readonly accountNumber?: string
  readonly phone?: string
  readonly taxType?: PartnerTaxType
  readonly partnerShipping?: PartnerShipping | null
}

export interface DocumentPostalSentReminder {
  readonly status?: ConsignmentStatus
  readonly sendAt?: string
}

export interface DocumentProductData {
  readonly name: string
  readonly unitPrice: number
  readonly unitPriceType: UnitPriceType
  readonly quantity: number
  readonly unit: string
  readonly vat: Vat
  readonly comment?: string
  readonly entitlement?: Entitlement
  readonly sku?: string
  readonly dataEraserCodes?: string
  readonly isGenerateEraseCode?: boolean
}

export interface DocumentPublicUrl {
  readonly publicUrl?: string
}

export interface DocumentReminderEventList {
  readonly sentReminders?: readonly DocumentSentReminder[]
  readonly upcomingReminders?: readonly DocumentUpcomingReminder[]
  readonly sentPostalMail?: readonly DocumentPostalSentReminder[]
}

export interface DocumentSentReminder {
  readonly type?: EmailType
  readonly deliveryAt?: string
  readonly sendAt?: string
  readonly openAt?: string
  readonly subject?: string
  readonly recipients?: readonly string[]
  readonly status?: SentEmailStatus
}

export interface DocumentSettings {
  readonly mediatedService?: boolean
  readonly withoutFinancialFulfillment?: boolean
  readonly onlinePayment?: OnlinePayment
  readonly shouldSendEmail?: boolean
  readonly round?: Round
  readonly noSendOnlineszamlaByUser?: boolean
  readonly dontSendToNavReason?: DontSendToNavReason | null
  readonly orderNumber?: string
  readonly placeId?: number | null
  readonly instantPayment?: boolean | null
  readonly selectedType?: DocumentType | null
  readonly instantPaymentRequest?: DocumentInstantPaymentRequest | null
  readonly isWaybillHidePrices?: boolean | null
}

export interface DocumentSummary {
  readonly netAmount?: number
  readonly netAmountLocal?: number
  readonly grossAmountLocal?: number
  readonly vatAmount?: number
  readonly vatAmountLocal?: number
  readonly vatRateSummary?: readonly DocumentVatRateSummary[]
}

export type DocumentType =
  | 'advance'
  | 'cancellation'
  | 'cert_of_completion'
  | 'd_cert_of_completion'
  | 'dossier'
  | 'draft'
  | 'draft_offer'
  | 'draft_order_form'
  | 'draft_waybill'
  | 'invoice'
  | 'modification'
  | 'offer'
  | 'order_form'
  | 'proforma'
  | 'receipt'
  | 'receipt_cancellation'
  | 'waybill'

export interface DocumentUpcomingReminder {
  readonly subject?: string
  readonly emails?: readonly string[]
  readonly sendAt?: string
}

export interface DocumentVatRateSummary {
  readonly vatName?: string
  readonly vatPercentage?: number
  readonly vatRateNetAmount?: number
  readonly vatRateVatAmount?: number
  readonly vatRateVatAmountLocal?: number
  readonly vatRateGrossAmount?: number
}

export type DontSendToNavReason = 'dont_send_foreign' | 'dont_send_oss' | 'dont_send_other'

export interface Email {
  readonly email?: string
}

export type EmailType =
  | 'affiliate'
  | 'api_limit_warning'
  | 'auth_log'
  | 'bank_account_save'
  | 'bank_card_expiry_reminder'
  | 'bank_card_next_charge'
  | 'bob_expiry'
  | 'business_plus'
  | 'buy_api_limit'
  | 'cannot_renew_subscription'
  | 'cm_contract_notification'
  | 'cm_subscription_limit'
  | 'document_reminder'
  | 'email_changed'
  | 'email_tfa_token'
  | 'fake_pincode_sms'
  | 'flat_tax_deadline_task'
  | 'new_invoice'
  | 'online_szamla_email'
  | 'organization_changed'
  | 'paid_document'
  | 'partnermonitor_notification'
  | 'passwordless_login'
  | 'proforma_expired_reminder'
  | 'proforma_expiry_reminder'
  | 'softpos_cancel_transaction'
  | 'softpos_notification'
  | 'taxpayer_verification'
  | 'tm_consultation'
  | 'tm_notification'
  | 'tm_prequalification'
  | 'transaction_expired_reminder'
  | 'transaction_expiry_reminder'
  | 'unas_autosync_disabled'
  | 'user_changed'
  | 'user_invitation'
  | 'user_registration'
  | 'user_reset_password'
  | 'user_terms'

export type Entitlement =
  | 'AAM'
  | 'ANTIQUES'
  | 'ARTWORK'
  | 'ATK'
  | 'EAM'
  | 'EUE'
  | 'EUFAD37'
  | 'EUFADE'
  | 'HO'
  | 'KBAET'
  | 'NAM_1'
  | 'NAM_2'
  | 'SECOND_HAND'
  | 'TAM'
  | 'TRAVEL_AGENCY'
  | 'WITHOUT_ENTITLEMENT'

export type Feature =
  | 'api_limit_basic'
  | 'api_limit_max'
  | 'api_limit_pro'
  | 'api_limit_pro_limited'
  | 'api_limit_standard'
  | 'banksync_plus'
  | 'billingo_business'
  | 'billingo_one'
  | 'campaign_manager_basic'
  | 'campaign_manager_standard'
  | 'ceginfo_enterprise'
  | 'ceginfo_pro'
  | 'ceginfo_standard'
  | 'flat_tax_plus'
  | 'innovator'
  | 'inventory'
  | 'limit_increase'
  | 'master'
  | 'partnermonitor_basic'
  | 'partnermonitor_pro'
  | 'partnermonitor_standard'
  | 'softpos'
  | 'subscription_basic'
  | 'subscription_pro'
  | 'subscription_standard'
  | 'tendermonitor_standard'
  | 'tendermonitor_vip'
  | 'whitelabel'

export type FinancialFulfillmentHighlight = 'basic' | 'highlighted' | 'paid_stamp'

export interface Id {
  readonly id?: number
  readonly legacyId?: number
}

export type InvoiceNumberFormat = 'default' | 'short_with_hyphen'

export interface InvoiceSettings {
  readonly documentType?: DocumentType
  readonly fulfillmentDate?: string
  readonly dueDate?: string
  readonly documentFormat?: DocumentFormat
  readonly comment?: string
}

export type KobakReceiptStatus = 'error_no_access' | 'error_permanent' | 'pending' | 'success'

export interface LedgerNumberInformation {
  readonly bevetel?: string
  readonly vevo?: string
  readonly penztar?: string
  readonly afa?: string
}

export interface ModificationDocumentInsert {
  readonly dueDate?: string
  readonly comment?: string
  readonly paymentMethod?: PaymentMethod
  readonly withoutFinancialFulfillment?: boolean
  readonly items?: readonly (DocumentItemData | DocumentProductData)[]
}

export interface Money {
  readonly amount?: number
  readonly currency?: Currency
}

export type OnlinePayment = '' | 'Barion' | 'SimplePay' | 'Stripe' | 'no'

export interface OnlineSzamlaStatus {
  readonly transactionId?: string
  readonly status?: string
  readonly messages?: readonly OnlineSzamlaStatusMessage[]
}

export type OnlineSzamlaStatusEnum =
  | 'aborted'
  | 'done'
  | 'dont_send_external_import'
  | 'dont_send_foreign'
  | 'dont_send_oss'
  | 'dont_send_other'
  | 'empty_organization_country_code'
  | 'empty_partner_country_code'
  | 'empty_tax'
  | 'forbidden'
  | 'invalid_address'
  | 'invalid_client'
  | 'invalid_conversion_rate'
  | 'invalid_customer'
  | 'invalid_invoice_reference'
  | 'invalid_postalcode'
  | 'invalid_request_signature'
  | 'invalid_security_user'
  | 'invalid_tax'
  | 'invalid_tax_number'
  | 'invalid_user_relation'
  | 'invalid_vat_data'
  | 'invoice_number_not_unique'
  | 'kobak_processing'
  | 'missing_document_item_name'
  | 'nav_warn'
  | 'no_online_szamla_settings'
  | 'no_send_by_user'
  | 'non_exist_tax_number'
  | 'not unique'
  | 'not_checked'
  | 'not_registered_customer'
  | 'processing'
  | 'received'
  | 'saved'
  | 'send_failed'
  | 'sent'
  | 'started'
  | 'technical_error'
  | 'under_tax_limit'
  | 'user_has_invalid_kobak'
  | 'user_hasnot_kobak'
  | 'validation_ok'

export interface OnlineSzamlaStatusMessage {
  readonly validationResultCode?: string
  readonly validationErrorCode?: string
  readonly humanReadableMessage?: string
}

export interface OrganizationData {
  readonly taxCode?: string
  readonly subscription?: Subscription
  readonly hasNavConnection?: boolean
  readonly kobakReceiptFsEnabled?: boolean
  readonly hasSuccessfulNavReceiptSubmission?: boolean
}

export interface Partner {
  readonly id?: number
  readonly name?: string
  readonly address?: Address
  readonly emails?: readonly string[]
  readonly taxcode?: string
  readonly iban?: string
  readonly swift?: string
  readonly accountNumber?: string
  readonly phone?: string
  readonly generalLedgerNumber?: string
  readonly taxType?: PartnerTaxType
  readonly customBillingSettings?: PartnerCustomBillingSettings
  readonly groupMemberTaxNumber?: string | null
  readonly giroSettings?: PartnerGiroSettings | null
  readonly partnerShipping?: PartnerShipping | null
  readonly internalComment?: string | null
  readonly partnerShowType?: PartnerShowType | null
}

export interface PartnerAutocomplete {
  readonly id?: number
  readonly name?: string
  readonly emails?: readonly Email[]
}

export interface PartnerCustomBillingSettings {
  readonly paymentMethod?: PaymentMethod | null
  readonly documentForm?: DocumentForm | null
  readonly dueDays?: number
  readonly documentCurrency?: Currency
  readonly templateLanguageCode?: DocumentLanguage | null
  readonly discount?: Discount | null
  readonly customLabel?: CustomLabel | null
}

export interface PartnerGiroSettings {
  readonly giroDefaultSettings?: boolean
  readonly giroPaymentRequestEnabled?: boolean
  readonly giroDifferentAmountAllowed?: boolean
}

export interface PartnerList {
  readonly data?: readonly Partner[]
  readonly total?: number
  readonly perPage?: number
  readonly currentPage?: number
  readonly lastPage?: number
  readonly prevPageUrl?: string
  readonly nextPageUrl?: string
}

export interface PartnerListForReceiptAutocomplete {
  readonly data?: readonly PartnerAutocomplete[]
}

export interface PartnerShipping {
  readonly match?: boolean
  readonly name?: string
  readonly mode?: ShippingMode
  readonly address?: Address | null
}

export type PartnerShowType = 'show_all' | 'show_incoming' | 'show_outgoing'

export type PartnerTaxType = '' | 'FOREIGN' | 'HAS_TAX_NUMBER' | 'NO_TAX_NUMBER'

export interface PaymentHistory {
  readonly date: string
  readonly price: number
  readonly paymentMethod: PaymentMethod
  readonly voucherNumber?: string | null
  readonly conversionRate?: number | null
}

export type PaymentMethod =
  | 'aruhitel'
  | 'bankcard'
  | 'barion'
  | 'barter'
  | 'cash'
  | 'cash_on_delivery'
  | 'cod_balance'
  | 'combined'
  | 'coupon'
  | 'credit'
  | 'ebay'
  | 'elore_utalas'
  | 'ep_kartya'
  | 'kompenzacio'
  | 'levonas'
  | 'online_bankcard'
  | 'other'
  | 'paylike'
  | 'payoneer'
  | 'paypal'
  | 'paypal_utolag'
  | 'payu'
  | 'pick_pack_pont'
  | 'postai_csekk'
  | 'postautalvany'
  | 'revolut'
  | 'simple_pay'
  | 'skrill'
  | 'stripe'
  | 'szep_card'
  | 'transferwise'
  | 'upwork'
  | 'utalvany'
  | 'valto'
  | 'wire_transfer'

export type PaymentStatus = 'expired' | 'none' | 'outstanding' | 'paid' | 'partially_paid'

export type PaymentStatusSpending = 'all' | 'expired' | 'paid' | 'unpaid'

export interface Product {
  readonly id?: number
  readonly name: string
  readonly comment?: string
  readonly currency: Currency
  readonly vat: Vat
  readonly netUnitPrice?: number
  readonly grossUnitPrice?: number
  readonly unit: string
  readonly generalLedgerNumber?: string
  readonly generalLedgerTaxcode?: string
  readonly entitlement?: Entitlement
  readonly ean?: string
  readonly sku?: string
  readonly isManage?: boolean
  readonly purchasePrice?: number
  readonly isGenerateEraseCode?: boolean
  readonly connectProductId?: number
  readonly applyDiscount?: boolean
  readonly applyQuantity?: boolean
  readonly isConnectProduct?: boolean
  readonly isDepositFee?: boolean
}

export interface ProductList {
  readonly data?: readonly Product[]
  readonly total?: number
  readonly perPage?: number
  readonly currentPage?: number
  readonly lastPage?: number
  readonly prevPageUrl?: string
  readonly nextPageUrl?: string
}

export interface ProductQuantity {
  readonly availableQuantity?: number
}

export interface ReceiptInsert {
  readonly vendorId?: string
  readonly partnerId?: number
  readonly name?: string
  readonly emails?: readonly string[]
  readonly blockId: number
  readonly type: DocumentType
  readonly paymentMethod: PaymentMethod
  readonly currency: Currency
  readonly conversionRate?: number
  readonly electronic?: boolean
  readonly items?: readonly (ReceiptItemData | ReceiptProductData)[]
}

export interface ReceiptItemData {
  readonly productId: number
  readonly quantity?: number
}

export interface ReceiptProductData {
  readonly name?: string
  readonly unitPrice: number
  readonly vat: ReceiptVat
  readonly quantity?: number
  readonly unit?: string
}

export type ReceiptVat = 'none' | '5%' | '18%' | '27%' | 'AAM' | 'TAM'

export type Round = 'five' | 'none' | 'one' | 'ten'

export interface SendDocument {
  readonly emails?: readonly string[]
}

export interface SentEmailStatus {
  readonly status?: SentEmailStatusType
  readonly date?: string
}

export type SentEmailStatusType =
  | 'bounced'
  | 'clicked'
  | 'complained'
  | 'delivered'
  | 'none'
  | 'opened'
  | 'rejected'
  | 'rendering_failed'
  | 'sent'

export interface ServerError {
  readonly message?: string
  readonly traceId?: string
}

export interface ServerErrorResponse {
  readonly error?: ServerError
}

export interface ServerTime {
  readonly epoch?: number
  readonly formatted?: string
  readonly w3c?: string
  readonly timezone?: string
}

export type ShippingMode =
  | 'dhl_express'
  | 'dpd'
  | 'express_one'
  | 'fama_futar'
  | 'fedex'
  | 'foxpost'
  | 'gepard_futar'
  | 'gls'
  | 'go_futar'
  | 'home_delivery'
  | 'mpl'
  | 'none'
  | 'packeta'
  | 'personal_delivery'
  | 'sameday'
  | 'sprinter'
  | 'tnt_express'
  | 'ups'

export type Source = 'all' | 'manual' | 'nav'

export interface Spending {
  readonly id?: number
  readonly organizationId?: number
  readonly category?: Category
  readonly paidAt?: string | null
  readonly fulfillmentDate?: string
  readonly partner?: SpendingPartner
  readonly invoiceNumber?: string
  readonly currency?: Currency
  readonly conversionRate?: number
  readonly totalGross?: number
  readonly totalGrossLocal?: number
  readonly totalVatAmount?: number
  readonly totalVatAmountLocal?: number
  readonly invoiceDate?: string
  readonly dueDate?: string
  readonly paymentMethod?: SpendingPaymentMethod
  readonly comment?: string | null
  readonly items?: readonly SpendingItem[]
}

export interface SpendingItem {
  readonly name?: string
  readonly quantity?: number
  readonly unit?: string
  readonly comment?: string
  readonly vat?: string
  readonly netUnitPrice?: number
  readonly netUnitPriceLocal?: number
  readonly netPrice?: number
  readonly netPriceLocal?: number
  readonly vatAmount?: number
  readonly vatAmountLocal?: number
  readonly grossPrice?: number
  readonly grossPriceLocal?: number
}

export interface SpendingList {
  readonly data?: readonly SpendingListItem[]
  readonly total?: number
  readonly perPage?: number
  readonly currentPage?: number
  readonly lastPage?: number
  readonly prevPageUrl?: string
  readonly nextPageUrl?: string
}

export interface SpendingListItem {
  readonly id?: number
  readonly organizationId?: number
  readonly category?: Category
  readonly paidAt?: string | null
  readonly fulfillmentDate?: string
  readonly partner?: SpendingPartner
  readonly invoiceNumber?: string
  readonly currency?: Currency
  readonly conversionRate?: number
  readonly totalGross?: number
  readonly totalGrossLocal?: number
  readonly totalVatAmount?: number
  readonly totalVatAmountLocal?: number
  readonly invoiceDate?: string
  readonly dueDate?: string
  readonly paymentMethod?: SpendingPaymentMethod
  readonly comment?: string | null
  readonly isCreatedByNav?: boolean
}

export interface SpendingPartner {
  readonly id?: number
  readonly name?: string
  readonly taxCode?: string
  readonly address?: Address
  readonly iban?: string
  readonly swift?: string
  readonly accountNumber?: string
  readonly phone?: string
  readonly internalComment?: string
  readonly groupMemberTaxNumber?: string
}

export type SpendingPaymentMethod =
  | 'aruhitel'
  | 'bankcard'
  | 'barion'
  | 'barter'
  | 'cash'
  | 'cash_on_delivery'
  | 'cod_balance'
  | 'combined'
  | 'coupon'
  | 'credit'
  | 'ebay'
  | 'elore_utalas'
  | 'ep_kartya'
  | 'kompenzacio'
  | 'levonas'
  | 'online_bankcard'
  | 'other'
  | 'paylike'
  | 'payoneer'
  | 'paypal'
  | 'paypal_utolag'
  | 'payu'
  | 'pick_pack_pont'
  | 'postai_csekk'
  | 'postautalvany'
  | 'revolut'
  | 'simple_pay'
  | 'skrill'
  | 'stripe'
  | 'szep_card'
  | 'transferwise'
  | 'upwork'
  | 'utalvany'
  | 'valto'
  | 'wire_transfer'

export interface SpendingSave {
  readonly currency: Currency
  readonly conversionRate?: number
  readonly totalGross: number
  readonly totalGrossHuf: number
  readonly totalVatAmount: number
  readonly totalVatAmountHuf: number
  readonly fulfillmentDate: string
  readonly paidAt?: string
  readonly category: Category
  readonly comment?: string
  readonly invoiceNumber?: string
  readonly invoiceDate?: string
  readonly dueDate?: string
  readonly paymentMethod: SpendingPaymentMethod
  readonly partnerId?: number
}

export interface SpendingShow {
  readonly id?: number
  readonly organizationId?: number
  readonly category?: Category
  readonly paidAt?: string | null
  readonly fulfillmentDate?: string
  readonly partner?: SpendingPartner
  readonly invoiceNumber?: string
  readonly currency?: Currency
  readonly conversionRate?: number
  readonly totalGross?: number
  readonly totalGrossLocal?: number
  readonly totalVatAmount?: number
  readonly totalVatAmountLocal?: number
  readonly invoiceDate?: string
  readonly dueDate?: string
  readonly paymentMethod?: SpendingPaymentMethod
  readonly comment?: string | null
  readonly items?: readonly SpendingItem[]
  readonly isCreatedByNav?: boolean
}

export interface Subscription {
  readonly expirationDate?: string
  readonly features?: readonly Feature[]
}

export interface SubscriptionErrorResponse {
  readonly error?: ClientError
}

export interface TaxNumber {
  readonly taxNumber?: string
  readonly result?: CheckTaxNumberMessage
}

export interface TaxNumberCheckResponse {
  readonly taxNumber: string
  readonly result: CheckTaxNumberMessage
  readonly taxpayerName?: string | null
  readonly taxpayerShortName?: string | null
  readonly addresses?: readonly TaxpayerAddress[] | null
}

export interface TaxpayerAddress {
  readonly type: 'HQ' | 'SITE' | 'BRANCH'
  readonly countryCode: string
  readonly region?: string | null
  readonly postalCode: string
  readonly city: string
  readonly streetName: string
  readonly publicPlaceCategory: string
  readonly number?: string | null
  readonly building?: string | null
  readonly staircase?: string | null
  readonly floor?: string | null
  readonly door?: string | null
  readonly lotNumber?: string | null
}

export interface TooManyRequestsResponse {
  readonly error?: ClientError
}

export type UnitPriceType = 'gross' | 'net'

export interface ValidationError {
  readonly field?: string
  readonly message?: string
}

export interface ValidationErrorResponse {
  readonly message?: string
  readonly errors?: readonly ValidationError[]
}

export type Vat =
  | '0%'
  | '1%'
  | '10%'
  | '11%'
  | '12%'
  | '13%'
  | '13,5%'
  | '14%'
  | '15%'
  | '16%'
  | '17%'
  | '18%'
  | '19%'
  | '2%'
  | '20%'
  | '21%'
  | '22%'
  | '23%'
  | '24%'
  | '25%'
  | '25,5%'
  | '26%'
  | '27%'
  | '3%'
  | '4%'
  | '5%'
  | '5,5%'
  | '6%'
  | '7%'
  | '7,7%'
  | '8%'
  | '8,1%'
  | '9%'
  | '9,5%'
  | 'AAM'
  | 'AM'
  | 'EU'
  | 'EUK'
  | 'F.AFA'
  | 'FAD'
  | 'K.AFA'
  | 'MAA'
  | 'TAM'
  | 'ÁKK'
  | 'ÁTHK'
