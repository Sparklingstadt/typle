"use client"
import { useRef } from "react"
import { useTranslations } from "next-intl"
import DeleteConfirmation from "@/components/DeleteConfirmation"
import { focusAfterRemoval } from "@/lib/focusAfterRemoval"
import type { PackOverview } from "@/core/packOverview"
import type { WordPack } from "@/core/wordPacks"

export default function DeletePackDialog({ state, onOpenChange, onDelete }: {
  state: { open: boolean; item: PackOverview | null; position: number }
  onOpenChange: (open: boolean) => void
  onDelete: (pack: WordPack) => Promise<boolean>
}) {
  const t = useTranslations('wordLists')
  const packDeleted = useRef(false)
  if (!state.item) return null
  const item = state.item
  return <DeleteConfirmation open={state.open} onOpenChange={onOpenChange}
    title={t('delete.packTitle', { name: item.pack.name })}
    description={t('delete.packDescription', { lists: item.lists.length, records: item.practiceCount })}
    // After a pack is deleted, focus the pack that took its place, or the heading when none is left.
    onCloseAutoFocus={event => {
      focusAfterRemoval(event, '[data-pack-id] h3 button', state.position, packDeleted.current)
      packDeleted.current = false
    }}
    onConfirm={async () => {
      const pack = state.item?.pack
      if (!pack) return false
      const saved = await onDelete(pack)
      if (saved) packDeleted.current = true
      return saved
    }} />
}
