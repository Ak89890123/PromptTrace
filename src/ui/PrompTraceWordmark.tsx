type PrompTraceWordmarkProps = {
  className?: string;
};

export function PrompTraceWordmark({ className = '' }: PrompTraceWordmarkProps) {
  return (
    <span className={['pt-wordmark', className].filter(Boolean).join(' ')} role="img" aria-label="PrompTrace">
      <span className="pt-wordmark-promp" aria-hidden="true">Promp</span>
      <span className="pt-wordmark-t" aria-hidden="true">T</span>
      <span className="pt-wordmark-race" aria-hidden="true">race</span>
    </span>
  );
}
