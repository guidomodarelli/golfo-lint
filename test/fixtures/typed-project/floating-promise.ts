type PersistRecord = (record: string) => Promise<void>;

async function saveRecord(record: string, persist: PersistRecord): Promise<string> {
  await persist(record);
  return record;
}

export function storeRecord(record: string, persist: PersistRecord): void {
  saveRecord(record, persist);
}
