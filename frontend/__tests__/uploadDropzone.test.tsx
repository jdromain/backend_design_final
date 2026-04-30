import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { UploadDropzone } from "@/components/knowledge/upload-dropzone"

describe("UploadDropzone previous upload tracking", () => {
  it("keeps staged files across non-transition rerenders and clears only after upload completes", () => {
    const onFilesSelected = vi.fn()
    const file = new File(["hello"], "doc.txt", { type: "text/plain" })

    const { container, rerender } = render(
      <UploadDropzone
        onFilesSelected={onFilesSelected}
        accept=".txt,.md"
        formatHint="TXT, MD"
        isUploading={false}
      />,
    )

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    expect(onFilesSelected).toHaveBeenCalledTimes(1)
    expect(screen.getByText("doc.txt")).toBeInTheDocument()

    rerender(
      <UploadDropzone
        onFilesSelected={onFilesSelected}
        accept=".txt,.md"
        formatHint="TXT, MD"
        isUploading={false}
      />,
    )

    expect(screen.getByText("doc.txt")).toBeInTheDocument()

    rerender(
      <UploadDropzone
        onFilesSelected={onFilesSelected}
        accept=".txt,.md"
        formatHint="TXT, MD"
        isUploading={true}
      />,
    )

    rerender(
      <UploadDropzone
        onFilesSelected={onFilesSelected}
        accept=".txt,.md"
        formatHint="TXT, MD"
        isUploading={false}
      />,
    )

    expect(screen.queryByText("doc.txt")).not.toBeInTheDocument()
    expect(screen.getByText("Upload complete")).toBeInTheDocument()
  })
})
