"""Run interpreter bench cases through Gemma 4 E2B (the app's .litertlm, LiteRT-LM CPU).
Usage: mt_gemma.py model.litertlm cases.jsonl out.jsonl [threads]"""
import json, sys, time
import litert_lm

model, cases, out = sys.argv[1], sys.argv[2], sys.argv[3]
threads = int(sys.argv[4]) if len(sys.argv) > 4 else 4
litert_lm.set_min_log_severity(litert_lm.LogSeverity.ERROR)
eng = litert_lm.Engine(model, backend=litert_lm.interfaces.CPU(thread_count=threads), max_num_tokens=2048)
done = set()
try:
    for l in open(out):
        d = json.loads(l)
        done.add((d['lang'], d['i'], d.get('control')))
except FileNotFoundError:
    pass
with open(out, 'a') as f:
    for line in open(cases):
        c = json.loads(line)
        if (c['lang'], c['i'], c.get('control')) in done:
            continue
        conv = eng.create_conversation(system_message=c['system'], max_output_tokens=160)
        t0 = time.time()
        msg = conv.send_message(c['prompt'])
        dt = time.time() - t0
        text = ''.join(p.get('text', '') for p in msg['content']) if isinstance(msg, dict) else str(msg)
        c['reply'] = text
        c['ms'] = round(dt * 1000)
        c.pop('system'); c.pop('prompt')
        f.write(json.dumps(c, ensure_ascii=False) + '\n'); f.flush()
        print(c['lang'], c['i'], c.get('control', ''), c['ms'], text.replace('\n', ' | ')[:120], flush=True)
        conv.close()
