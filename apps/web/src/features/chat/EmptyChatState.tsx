export function EmptyChatState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Apa yang ingin Anda kerjakan?</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Pilih Connector lewat menu (+) bila perlu router, atau langsung tanya jawab umum.
      </p>
    </div>
  );
}
