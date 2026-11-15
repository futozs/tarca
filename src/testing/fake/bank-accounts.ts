import { isCurrency } from './enums'
import {
  bodyFields,
  type FakeFieldError,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  forbidden,
  noContent,
  ok,
  optionalBoolean,
  optionalString,
  paginate,
  positiveIntegerParam,
  requiredEnum,
  requiredString,
  validationFailed,
} from './http'
import { type FakeBankAccount, type FakeBillingoState, nextId } from './state'

type BankAccountFields = Omit<FakeBankAccount, 'id'>

function readBankAccount(
  body: unknown,
): { readonly fields: BankAccountFields } | { readonly errors: FakeFieldError[] } {
  const input = bodyFields(body)
  const errors: FakeFieldError[] = []
  const name = requiredString(input, 'name', errors)
  const accountNumber = requiredString(input, 'account_number', errors)
  const currency = requiredEnum(input, 'currency', isCurrency, errors)
  const accountNumberIban = optionalString(input, 'account_number_iban', errors)
  const swift = optionalString(input, 'swift', errors)
  const needQr = optionalBoolean(input, 'need_qr', errors)
  if (errors.length > 0 || currency === undefined) return { errors }
  return { fields: { name, accountNumber, accountNumberIban, swift, currency, needQr } }
}

function withExisting(
  state: FakeBillingoState,
  request: FakeRequest,
  respond: (account: FakeBankAccount) => FakeResponse,
): FakeResponse {
  const id = positiveIntegerParam(request, 'id')
  const account = id === undefined ? undefined : state.bankAccounts.get(id)
  return account ? respond(account) : forbidden()
}

export const bankAccountRoutes: FakeRoutes = {
  ListBankAccount: (state, request) =>
    paginate(
      request,
      [...state.bankAccounts.values()].sort((a, b) => b.id - a.id),
    ),
  CreateBankAccount: (state, request) => {
    const input = readBankAccount(request.body)
    if ('errors' in input) return validationFailed(input.errors)
    const account: FakeBankAccount = { id: nextId(state, 'bankAccounts'), ...input.fields }
    state.bankAccounts.set(account.id, account)
    return ok(account, 201)
  },
  GetBankAccount: (state, request) => withExisting(state, request, (account) => ok(account)),
  UpdateBankAccount: (state, request) =>
    withExisting(state, request, (existing) => {
      const input = readBankAccount(request.body)
      if ('errors' in input) return validationFailed(input.errors)
      const account: FakeBankAccount = { id: existing.id, ...input.fields }
      state.bankAccounts.set(account.id, account)
      return ok(account)
    }),
  DeleteBankAccount: (state, request) =>
    withExisting(state, request, (account) => {
      state.bankAccounts.delete(account.id)
      return noContent()
    }),
}
