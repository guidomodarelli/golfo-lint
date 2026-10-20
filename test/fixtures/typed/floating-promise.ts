async function saveRecord(record: string): Promise<string> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return record;
}

export function storeRecord(record: string): void {
  saveRecord(record);
}
