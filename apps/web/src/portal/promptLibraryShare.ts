export async function copyPromptLibraryEntryLink(input: {
  url: string
}): Promise<void> {
  await navigator.clipboard.writeText(input.url)
}
