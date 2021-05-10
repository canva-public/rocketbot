/**
 * Returns the URL component of an SSH URI. That is, it removes everything
 * before the @ sign, if it exists:
 *
 *    user@hostname:path/to/resource  ==> hostname:path/to/resource
 *    ssh://hostname:path/to/resource ==> hostname:path/to/resource
 *
 * @return The URL component of an SSH URI.
 */
export function urlPart(sshUri: string): string | undefined {
  if (!sshUri) {
    throw new Error(`Invalid SSH URI: ${sshUri}`);
  }

  const parts = sshUri.split('@');
  if (parts.length > 2) {
    throw new Error(`Invalid SSH URI; Contains too many @-signs: ${sshUri}`);
  } else {
    return parts.pop();
  }
}
