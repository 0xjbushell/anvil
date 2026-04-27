declare module "write-file-atomic" {
  function writeFileAtomic(
    filename: string,
    data: string | Buffer,
    options: string,
  ): Promise<void>;

  function writeFileAtomic(
    filename: string,
    data: string | Buffer,
    options?: { encoding?: BufferEncoding; mode?: number },
  ): Promise<void>;

  export default writeFileAtomic;
}
