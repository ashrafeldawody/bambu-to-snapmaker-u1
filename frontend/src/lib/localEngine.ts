interface EngineReply {
  ok: boolean;
  status: number;
  body?: unknown;
  detail?: string;
}

interface PendingCall {
  resolve: (value: { reply: EngineReply; output?: ArrayBuffer }) => void;
  reject: (error: Error) => void;
}

type EngineState = 'starting' | 'ready' | 'failed';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingCall>();
const outputs = new Map<string, { url: string; name: string }>();
const stateListeners = new Set<(state: EngineState, detail?: string) => void>();
let engineState: EngineState = 'starting';
let engineDetail = '';

function setState(state: EngineState, detail = '') {
  engineState = state;
  engineDetail = detail;
  for (const listener of stateListeners) listener(state, detail);
}

function failAll(detail: string) {
  for (const call of pending.values()) call.reject(new Error(`500: ${detail}`));
  pending.clear();
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker('/worker/py-worker.js', { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type === 'ready') return setState('ready');
    if (data?.type === 'failed') {
      setState('failed', data.detail);
      return failAll(data.detail);
    }
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    call.resolve({ reply: data.reply, output: data.output });
  };
  worker.onerror = (event) => {
    const detail = event.message || 'The converter engine crashed';
    setState('failed', detail);
    failAll(detail);
  };
  return worker;
}

export function onEngineState(listener: (state: EngineState, detail?: string) => void): () => void {
  ensureWorker();
  stateListeners.add(listener);
  listener(engineState, engineDetail);
  return () => stateListeners.delete(listener);
}

async function invoke<T>(method: string, args: Record<string, unknown> = {}, file?: File): Promise<T> {
  const target = ensureWorker();
  const id = nextId++;
  const buffer = file ? await file.arrayBuffer() : undefined;
  const { reply, output } = await new Promise<{ reply: EngineReply; output?: ArrayBuffer }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, method, args, file: buffer, fileName: file?.name }, buffer ? [buffer] : []);
  });
  if (!reply.ok) throw new Error(`${reply.status}: ${reply.detail ?? 'Request failed'}`);
  const body = reply.body as T & { job_id?: string; download_name?: string };
  if (output && body?.job_id) {
    const url = URL.createObjectURL(new Blob([output], { type: 'application/octet-stream' }));
    outputs.set(body.job_id, { url, name: body.download_name ?? 'converted.3mf' });
  }
  return body;
}

export const localEngine = {
  invoke,
  downloadUrl(jobId: string): string {
    return outputs.get(jobId)?.url ?? '#';
  },
};
