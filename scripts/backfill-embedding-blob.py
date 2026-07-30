# -*- coding: utf-8 -*-
"""将 vector_embedding 表中的 JSON 文本向量迁移为 BLOB 二进制格式 (性能优化回填)"""
import json
import os
import sqlite3
import struct
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(PROJECT_ROOT, "test-data-perf", "novel_ai_writer.db")

conn = sqlite3.connect(DB_PATH)
cols = [r[1] for r in conn.execute("PRAGMA table_info(vector_embedding)")]
if "embedding_blob" not in cols:
    conn.execute("ALTER TABLE vector_embedding ADD COLUMN embedding_blob BLOB")
    conn.commit()

total = conn.execute("SELECT COUNT(*) FROM vector_embedding WHERE embedding_blob IS NULL AND embedding != '[]'").fetchone()[0]
print(f"待迁移: {total} 行")

done = 0
while True:
    rows = conn.execute(
        "SELECT id, embedding FROM vector_embedding WHERE embedding_blob IS NULL AND embedding != '[]' LIMIT 2000"
    ).fetchall()
    if not rows:
        break
    batch = []
    for rid, emb_json in rows:
        vec = json.loads(emb_json)
        blob = struct.pack(f"<{len(vec)}f", *vec)
        batch.append((blob, rid))
    conn.executemany("UPDATE vector_embedding SET embedding_blob = ?, embedding = '[]' WHERE id = ?", batch)
    conn.commit()
    done += len(batch)
    if done % 10000 < 2000:
        print(f"  {done}/{total}")

print("VACUUM 回收空间...")
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.execute("VACUUM")
conn.close()
print(f"完成, 新文件大小: {os.path.getsize(DB_PATH) / 1024 / 1024:.1f} MB")
