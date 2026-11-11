import { test } from 'node:test';

test.todo('onSave accepts a valid message, writes the dlSave key before download, and replies with chromeId');
test.todo('onSave deletes the entry and replies ok false when download rejects');
test.todo('onSave rejects a web page sender, options.html, a foreign blobUrl, bad paths and bad sizes without calling download');
test.todo('onSave starts no second Chrome download for a record whose save is in progress or complete');
test.todo('onChanged: a filename delta sends one path event');
test.todo('onChanged: complete with the right fileSize sends done then deletes the entry');
test.todo('onChanged: a wrong fileSize sends failed FILE_SIZE_MISMATCH');
test.todo('onChanged: interrupted sends failed with the error');
test.todo('onChanged: an unknown url sends nothing');
test.todo('onChanged: a failing sendToEngine keeps the entry');
test.todo('onChanged: filename and state in one delta send path before done');
test.todo('recoverSaves: complete sends done, interrupted sends failed, in_progress sends nothing');
test.todo('recoverSaves: an entry without chromeId is adopted by url, or deleted with NOT_STARTED');
