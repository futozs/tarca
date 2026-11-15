import { expect } from 'vitest'
import type { OperationId } from '../../../src/core/operations'
import type { E2eContext, E2eExclusions } from '../context'

export const DOCUMENT_BLOCKS_E2E_OPERATIONS: readonly OperationId[] = [
  'ListDocumentBlock',
  'CreateDocumentBlock',
  'GetDocumentBlock',
  'UpdateDocumentBlock',
  'DeleteDocumentBlock',
]

export const DOCUMENT_BLOCKS_E2E_EXCLUDED: E2eExclusions = {}

function blockPrefix(runId: string): string {
  return `T${runId.slice(-3).replace(/\d/g, (digit) => 'ABCDEFGHIJ'.charAt(Number(digit)))}`
}

export function defineDocumentBlocksSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  const name = `TARCA E2E ${ctx.runId}`
  const prefix = blockPrefix(ctx.runId)
  let blockId: number | undefined
  step('lista: a legrégebbi elöl, a számla- és a nyugtatömb a közös állapotba', async () => {
    const blocks = (await ctx.tarca.documentBlocks.list({ perPage: 100 })).data
    const ids = blocks.map((block) => block.id ?? 0)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    ctx.state.blockId = ctx.required(
      blocks.find((block) => block.type === 'invoice')?.id,
      'számlatömb (invoice)',
    )
    ctx.state.receiptBlockId = ctx.required(
      blocks.find((block) => block.type === 'receipt')?.id,
      'nyugtatömb (receipt)',
    )
  })
  step('típus szerinti szűrés', async () => {
    const receipts = (await ctx.tarca.documentBlocks.list({ type: 'receipt', perPage: 100 })).data
    expect(receipts.every((block) => block.type === 'receipt')).toBe(true)
    expect(receipts.map((block) => block.id)).toContain(ctx.state.receiptBlockId)
  })
  step('futásonkénti tömb létrehozása és lekérése', async () => {
    const created = await ctx.tarca.documentBlocks.create({ name, prefix, type: 'invoice' })
    blockId = ctx.required(created.id, 'e2e tömb id')
    const fetched = await ctx.tarca.documentBlocks.get(blockId)
    expect([fetched.name, fetched.prefix, fetched.type]).toEqual([name, prefix, 'invoice'])
  })
  step('a lekért tömb visszaírható, a PUT teljes csere', async () => {
    const id = ctx.required(blockId, 'e2e tömb id')
    const fetched = await ctx.tarca.documentBlocks.get(id)
    const written = await ctx.tarca.documentBlocks.update(id, {
      ...fetched,
      customField1: 'tarca',
      senderName: 'TARCA E2E',
    })
    expect([written.customField1, written.senderName]).toEqual(['tarca', 'TARCA E2E'])
    const replaced = await ctx.tarca.documentBlocks.update(id, { name, prefix, type: 'invoice' })
    expect([replaced.customField1, replaced.senderName]).toEqual(['', ''])
  })
  step('törlés, utána a lekérés 403, és a listában sincs', async () => {
    const id = ctx.required(blockId, 'e2e tömb id')
    await ctx.tarca.documentBlocks.delete(id)
    await expect(ctx.tarca.documentBlocks.get(id)).rejects.toMatchObject({
      category: 'forbidden',
      status: 403,
    })
    const ids = (await ctx.tarca.documentBlocks.list({ perPage: 100 })).data.map(
      (block) => block.id,
    )
    expect(ids).not.toContain(id)
  })
}
