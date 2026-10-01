# tailor/

Whatever makes this copy someone's own lives here, and an update from the parent never
overwrites it. In the meta-template it is empty but for the private-words files below.

- `forbidden.sha256`: one SHA-256 per line of a word that must never appear outside `tailor/`
  (`node living/private-words.mjs --add <word>`). A template forbids its apps' names this way
  without ever containing them.
- `private-words.txt`: one word or phrase per line, in plain text, for an app forbidding its
  own names in its own repository.
