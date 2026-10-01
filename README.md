# living-template-template

The template every living template is made from. A living template is an app that keeps
improving after it is copied: each copy keeps whatever makes it someone's own in `tailor/`,
and every improvement to the template reaches every copy overnight, only if the copy's own
tests and build still pass.

This repository holds the machinery for that and nothing about any app. Start with
[`living/README.md`](living/README.md); to make a copy for someone, [`living/KIT.md`](living/KIT.md).

```bash
node --test 'living/test/*.test.mjs'     # the proofs
node living/private-words.mjs            # this repository holds no one's name
```
