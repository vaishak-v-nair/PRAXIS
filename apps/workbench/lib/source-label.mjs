/** A human label for where a review came from. The exact source remains in the record. */
export function sourceLabel(source) {
  if (/^upload:\/\//i.test(source)) return 'Uploaded folder';
  if (/^(?:https?:\/\/github\.com\/|git@github\.com:)/i.test(source)) return 'GitHub repository';
  if (/^(?:https?:\/\/|git@|ssh:\/\/)/i.test(source)) return 'Remote repository';
  if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(source)) return 'Local folder';
  return 'Project source';
}
