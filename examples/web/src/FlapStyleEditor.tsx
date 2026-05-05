import { useEffect, useRef } from "preact/hooks";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

type FlapStyleEditorProps = {
    value: string;
    onChange: (next: string) => void;
};

type MonacoWindow = Window & {
    MonacoEnvironment?: {
        getWorker?: (workerId: string, label: string) => Worker;
    };
};

const monacoHost = globalThis as unknown as MonacoWindow;
if (!monacoHost.MonacoEnvironment?.getWorker) {
    monacoHost.MonacoEnvironment = {
        getWorker(_workerId: string, label: string) {
            if (label === "json") return new JsonWorker();
            return new EditorWorker();
        },
    };
}

/** JSON editor for {@link SplitFlap.createFLAP} `style` (Satori / flap text). */
export function FlapStyleEditor({ value, onChange }: FlapStyleEditorProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return;

        const ed = monaco.editor.create(el, {
            value,
            language: "json",
            theme: "vs",
            minimap: { enabled: false },
            fontSize: 13,
            tabSize: 2,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            formatOnPaste: true,
            formatOnType: true,
        });

        const sub = ed.onDidChangeModelContent(() => {
            onChangeRef.current(ed.getValue());
        });

        editorRef.current = ed;
        return () => {
            sub.dispose();
            ed.dispose();
            editorRef.current = null;
        };
    }, []);

    useEffect(() => {
        const ed = editorRef.current;
        if (!ed) return;
        const cur = ed.getValue();
        if (cur !== value) {
            ed.setValue(value);
        }
    }, [value]);

    return <div ref={hostRef} class="min-h-[12rem] w-full overflow-hidden rounded-box border border-base-300 bg-base-100" />;
}
