'use client'

import Editor, { type BeforeMount, loader, type OnMount } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'

type Monaco = Parameters<BeforeMount>[0]
type EditorInstance = Parameters<OnMount>[0]

export interface EditorMarker {
  readonly line: number
  readonly column?: number | undefined
  readonly message: string
}

const MODEL_URI = 'file:///sandbox/pelda.ts'
const THEME = 'tarca-editor'

const editorTheme = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'c9a3f5' },
    { token: 'string', foreground: 'eac07a' },
    { token: 'number', foreground: 'faa178' },
    { token: 'comment', foreground: '81878f', fontStyle: 'italic' },
    { token: 'type', foreground: '91c8f0' },
    { token: 'identifier', foreground: 'dfe1e5' },
    { token: 'delimiter', foreground: '90969e' },
  ],
  colors: {
    'editor.background': '#121922',
    'editor.foreground': '#dfe1e5',
    'editorLineNumber.foreground': '#595e66',
    'editorLineNumber.activeForeground': '#d2d4d8',
    'editor.lineHighlightBackground': '#1b222c',
    'editor.selectionBackground': '#23367b',
    'editor.inactiveSelectionBackground': '#1e2842',
    'editorCursor.foreground': '#7fa0fc',
    'editorIndentGuide.background1': '#2c333e',
    'editorWidget.background': '#1b222c',
    'editorWidget.border': '#2c333e',
    'editorHoverWidget.background': '#1b222c',
    'editorHoverWidget.border': '#2c333e',
    'editorSuggestWidget.background': '#1b222c',
    'editorSuggestWidget.border': '#2c333e',
    'editorSuggestWidget.selectedBackground': '#23367b',
    'scrollbarSlider.background': '#2c333e88',
    'scrollbarSlider.hoverBackground': '#3a4350aa',
  },
}

let typesPromise: Promise<void> | undefined
let configuredPath: string | undefined

function configureTypeScript(monaco: Monaco, typesUrl: string): Promise<void> {
  typesPromise ??= (async () => {
    const ts = monaco.typescript
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
      strict: true,
      allowNonTsExtensions: true,
      noEmit: true,
      moduleDetection: 3,
    } as Parameters<typeof ts.typescriptDefaults.setCompilerOptions>[0])
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })
    ts.typescriptDefaults.setEagerModelSync(true)
    const response = await fetch(typesUrl)
    if (!response.ok) return
    const manifest = (await response.json()) as { files: Record<string, string> }
    ts.typescriptDefaults.setExtraLibs(
      Object.entries(manifest.files).map(([filePath, content]) => ({ filePath, content })),
    )
  })()
  return typesPromise
}

export function CodeEditor({
  value,
  onChange,
  onRun,
  onReady,
  monacoPath,
  typesUrl,
  marker,
}: {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  onReady: () => void
  monacoPath: string
  typesUrl: string
  marker: EditorMarker | undefined
}) {
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<EditorInstance | null>(null)
  const runRef = useRef(onRun)
  runRef.current = onRun
  const [fontFamily] = useState(() => {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--ff-mono').trim()
    return family ? `${family}, ui-monospace, monospace` : 'ui-monospace, monospace'
  })

  if (configuredPath !== monacoPath) {
    loader.config({ paths: { vs: monacoPath } })
    configuredPath = monacoPath
  }

  useEffect(() => {
    const monaco = monacoRef.current
    const model = editorRef.current?.getModel()
    if (!monaco || !model) return
    monaco.editor.setModelMarkers(
      model,
      'tarca-sandbox',
      marker
        ? [
            {
              severity: monaco.MarkerSeverity.Error,
              message: marker.message,
              startLineNumber: marker.line,
              startColumn: marker.column ?? 1,
              endLineNumber: marker.line,
              endColumn: model.getLineMaxColumn(Math.min(marker.line, model.getLineCount())),
            },
          ]
        : [],
    )
  }, [marker])

  const beforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme(THEME, editorTheme)
    void configureTypeScript(monaco, typesUrl)
  }

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco
    editorRef.current = editor
    void document.fonts.ready.then(() => monaco.editor.remeasureFonts())
    editor.addAction({
      id: 'tarca.run',
      label: 'Futtatás',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => runRef.current(),
    })
    onReady()
  }

  return (
    <Editor
      path={MODEL_URI}
      language="typescript"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      beforeMount={beforeMount}
      onMount={onMount}
      theme={THEME}
      loading={<span className="sr-only">A szerkesztő betöltése…</span>}
      options={{
        fontFamily,
        fontSize: 13.5,
        lineHeight: 22,
        fontLigatures: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 16, bottom: 16 },
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 12,
        tabSize: 2,
        renderLineHighlight: 'line',
        smoothScrolling: true,
        automaticLayout: true,
        wordWrap: 'on',
        fixedOverflowWidgets: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        stickyScroll: { enabled: false },
        guides: { indentation: true },
        quickSuggestions: { other: true, comments: false, strings: true },
      }}
    />
  )
}
