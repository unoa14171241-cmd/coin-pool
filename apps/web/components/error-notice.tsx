export function ErrorNotice({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {message ?? "Something went wrong. Please try again."}
    </div>
  );
}
