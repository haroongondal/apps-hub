# K2 sqlite3 proof (desktop sqlite3 3.50.6, real schema v1..v7 incl. items_sender)

Setup: `schema.sql` is SCHEMA_V1..V7 extracted mechanically from `SqlItemStore.kt`. Every statement below is the exact text rendered from the Kotlin constants/functions by a throwaway JVM test (deleted, not committed). `now`=1000000000, `startOfDay`=990000000, `T`=999000000. Output `|` separated, no header.

## Fixtures

```sql
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(1,'h1','com.google.android.apps.messaging','Messages','8287','num:8287','8287','num:8287',NULL,'bank 1',999000001,999000001,NULL,0,'','s1');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(2,'h2','com.google.android.apps.messaging','Messages','8287','num:8287','8287','num:8287',NULL,'bank 2',999000002,999000002,NULL,0,'','s2');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(3,'h3','com.google.android.apps.messaging','Messages','8287','num:8287','8287','num:8287',NULL,'bank 3',999000003,999000003,NULL,0,'','s3');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(4,'h4','com.google.android.apps.messaging','Messages','8287','num:8287','8287','num:8287',NULL,'bank 4',999000004,999000004,NULL,0,'','s4');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(5,'h5','com.google.android.apps.messaging','Messages','8287','num:8287','8287','num:8287',NULL,'bank 5',999000005,999000005,NULL,0,'','s5');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(6,'h6','com.google.android.apps.messaging','Messages','8288','num:8288','8288','num:8288',NULL,'alfalah two',999000010,999000010,NULL,0,'','s6');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(7,'h7','com.google.android.apps.messaging','Messages','8290','num:8290','8290',NULL,NULL,'habib notif',999000011,999000011,NULL,0,'','s7');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(8,'h8','com.google.android.apps.messaging','Messages','9999','num:9999','9999','num:9999',NULL,'half 0',999000020,999000020,NULL,0,'','s8');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(9,'h9','com.google.android.apps.messaging','Messages','9999','num:9999','9999','num:9999',NULL,'half 1',999000021,999000021,NULL,0,'','s9');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(10,'h10','com.google.android.apps.messaging','Messages','9999','num:9999','9999','num:9999',NULL,'half 2',999000022,999000022,NULL,0,'','s10');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(11,'h11','com.google.android.apps.messaging','Messages','9999','num:9999','9999','num:9999',NULL,'half 3',999000023,999000023,NULL,0,'','s11');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(12,'h12','com.google.android.apps.messaging','Messages','7000','num:7000','7000','num:7000',NULL,'no ai',999000030,999000030,NULL,0,'','s12');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(13,'h13','com.google.android.apps.messaging','Messages','6001','num:6001','6001','num:6001',NULL,'sale 0',999000040,999000040,NULL,0,'','s13');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(14,'h14','com.google.android.apps.messaging','Messages','6001','num:6001','6001','num:6001',NULL,'sale 1',999000041,999000041,NULL,0,'','s14');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(15,'h15','com.google.android.apps.messaging','Messages','6001','num:6001','6001','num:6001',NULL,'sale 2',999000042,999000042,NULL,0,'','s15');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(16,'h16','com.google.android.apps.messaging','Messages','6004','num:6004','6004','num:6004',NULL,'promo 4',999000042,999000042,NULL,0,'','s16');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(17,'h17','com.google.android.apps.messaging','Messages','6002','num:6002','6002','num:6002',NULL,'p2 0',999000050,999000050,NULL,0,'','s17');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(18,'h18','com.google.android.apps.messaging','Messages','6002','num:6002','6002','num:6002',NULL,'p2 1',999000051,999000051,NULL,0,'','s18');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(19,'h19','com.google.android.apps.messaging','Messages','6003','num:6003','6003','num:6003',NULL,'ordinary',999000060,999000060,NULL,0,'','s19');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(20,'h20','com.google.android.apps.messaging','Messages','6005','num:6005','6005','num:6005',NULL,'plain 6005',999000070,999000070,NULL,0,'','s20');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(21,'h21','com.google.android.apps.messaging','Messages','6006','num:6006','6006','num:6006',NULL,'plain 6006',999000070,999000070,NULL,0,'','s21');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(22,'h22','com.google.android.apps.messaging','Messages','6007','num:6007','6007','num:6007',NULL,'plain 6007',999000070,999000070,NULL,0,'','s22');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(23,'h23','com.google.android.apps.messaging','Messages','6008','num:6008','6008','num:6008',NULL,'promo 8',999000042,999000042,NULL,0,'','s23');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(24,'h24','com.google.android.apps.messaging','Messages','5555','num:5555','5555','num:5555',NULL,'123456',999000080,999000080,1000,0,'','s24');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(25,'h25','com.android.mms','Messages2','6004','num:6004','6004','num:6004',NULL,'mms promo',999000090,999000090,NULL,0,'','s25');
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(26,'h26','com.daraz','Daraz','daraz','com.daraz:daraz',NULL,NULL,NULL,'deal 0',999000095,999000095,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(27,'h27','com.daraz','Daraz','daraz','com.daraz:daraz',NULL,NULL,NULL,'deal 1',999000096,999000096,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(28,'h28','com.daraz','Daraz','daraz','com.daraz:daraz',NULL,NULL,NULL,'deal 2',999000097,999000097,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(29,'h29','com.a.cal','Calendar','cal','com.a.cal:cal',NULL,NULL,NULL,'meeting a',999000100,999000100,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(30,'h30','com.b.cal','Calendar','cal','com.b.cal:cal',NULL,NULL,NULL,'meeting b',999000110,999000110,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(31,'h31','com.linkedin.android','LinkedIn','You','com.linkedin.android:you','1 new message','com.linkedin.android:1 new message',NULL,'hi',999000120,999000120,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(32,'h32','com.linkedin.android','LinkedIn','Ahmed','com.linkedin.android:ahmed','2 new messages','com.linkedin.android:2 new messages',NULL,'yo',999000121,999000121,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(33,'h33','com.whatsapp','WhatsApp','Sunflower','com.whatsapp:sunflower','Sunflower','com.whatsapp:sunflower',NULL,'urgent',999000130,999000130,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(34,'h34','com.whatsapp','WhatsApp','Old','com.whatsapp:old','Old','com.whatsapp:old',NULL,'old urgent',300000000,300000000,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(35,'h35','com.google.android.gm','Gmail','Alfalah','com.google.android.gm:alfalah',NULL,'com.google.android.gm:alfalah',NULL,'payment mail',999000004,999000004,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(101,'h101','com.whatsapp','WhatsApp','6001','num:6001','6001','num:6001',NULL,'wa from unsaved number',999000200,999000200,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(102,'h102','com.whatsapp','WhatsApp','6003','num:6003','6003','num:6003',NULL,'wa from override number',999000201,999000201,NULL,0,'',NULL);
INSERT INTO items(id,hash,pkg,app_label,sender,sender_key,conversation,conversation_key,title,text,posted_at,captured_at,otp_expires_at,deleted_by_sender,search,sms_hash) VALUES(103,'h103','com.whatsapp','WhatsApp','6008','num:6008','6008','num:6008',NULL,'wa older than promo sms',999000036,999000036,NULL,0,'',NULL);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(1,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(2,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(3,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(4,'money','x','high','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(5,'other','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(6,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(7,'money','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(8,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(9,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(10,'other','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(11,'message','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(13,'promotion','x','high','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(14,'promotion','x','high','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(15,'promotion','x','high','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(16,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(17,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(18,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(19,'message','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(20,'message','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(21,'message','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(22,'message','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(23,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(25,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(26,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(27,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(28,'promotion','x','normal','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(33,'message','x','high','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(34,'message','x','high','',0);
INSERT INTO ai_results(item_id,kind,summary,importance,tags,at) VALUES(35,'money','x','high','',0);
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(1,'OUT',50000,'PKR','Alfalah 2310','Shop A',999000004,0,NULL);
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(2,'OUT',100,'PKR','Alfalah 7777','Shop B',999000010,0,NULL);
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(3,'OUT',700,'PKR','Habib 5555','Shop C',999000011,0,NULL);
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(10,'OUT',1000,'PKR','Meezan 1','EMAN IFTIKHAR BAF',998995000,0,NULL);
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(11,'OUT',2000,'PKR','Meezan 1',NULL,998999000,0,'Eman Iftikhar Baf');
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(12,'IN',300,'PKR','Meezan 1',NULL,998998000,0,NULL);
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(13,'OUT',400,'PKR','Meezan 1','Mine',998997000,1,NULL);
INSERT INTO txns(id,direction,amount_minor,currency,account,counterparty,at,own,label) VALUES(14,'IN',500,'PKR','Meezan 1','Zed Shop',998996000,0,NULL);
INSERT INTO txn_sources(txn_id,item_id,channel,at) VALUES(1,4,'SMS',0);
INSERT INTO txn_sources(txn_id,item_id,channel,at) VALUES(2,6,'SMS',0);
INSERT INTO txn_sources(txn_id,item_id,channel,at) VALUES(3,7,'SMS',0);
INSERT INTO txn_sources(txn_id,item_id,channel,at) VALUES(1,35,'SMS',0);
INSERT INTO sender_names(sender_key,sender,name) VALUES('num:8288','8288','My bank');
INSERT INTO sender_promo(sender_key,promo) VALUES('num:6002',0),('num:6003',1);
```

Fixture map: num:8287 bank short code (5 items, 3 promotion, one a txn source `Alfalah 2310`, Gmail copy too); num:8288 txn source `Alfalah 7777`, renamed `My bank`; **num:8290 an SMS notification merged by setSmsHash: conversation_key NULL, it is the txn source (`Habib 5555`)**; num:9999 exactly half; num:7000 no AI; num:6001/6004/6008 promotional (lastAt T+42 tie); num:6002 override 0; num:6003 override 1; num:6005-6007 ordinary tie at T+70; num:5555 expired OTP only; com.android.mms only promotional num:6004; Daraz non-SMS promotion; two Calendar packages; LinkedIn generic titles; WhatsApp Sunflower high importance; WhatsApp items 101/102 on num:6001/num:6003; **WhatsApp item 103 on num:6008 posted at T+36, OLDER than the newest (promotional) SMS from num:6008 at T+42**; txns 10-14 for parties.

## PROMO_KEYS

Expected 6001, 6003, 6004, 6008.

```sql
SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1
```

### result


Parameters: `[]`

```
num:6001
num:6003
num:6004
num:6008
```

## smsPromotion(itemId)

```sql
SELECT CASE WHEN (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) THEN COALESCE(i.conversation_key, i.sender_key) IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1) END FROM items i WHERE i.id = ?
```

- SMS item of num:8287 (id 1) -> `0` expected 0
- SMS item of num:6001 (id 13) -> `1` expected 1
- SMS item of num:6002 (id 17) -> `0` expected 0
- SMS item of num:6003 (id 19) -> `1` expected 1
- SMS item of num:7000 (id 12) -> `0` expected 0
- Daraz item (id 28) -> `NULL` expected NULL
- WhatsApp item 101 (num:6001) (id 101) -> `NULL` expected NULL
- WhatsApp item 102 (num:6003) (id 102) -> `NULL` expected NULL
- WhatsApp item 103 (num:6008) (id 103) -> `NULL` expected NULL
- gone item (id 99999) -> `NULL` expected NULL

## promotions(pkg)

```sql
SELECT COUNT(DISTINCT COALESCE(i.conversation_key, i.sender_key)), MAX(i.posted_at) FROM items i WHERE i.pkg = ? AND (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND NOT (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1))
```

- `com.google.android.apps.messaging` (senders|lastAt) -> `4|999000060`
- `com.android.mms` (senders|lastAt) -> `1|999000090`
- `com.daraz` (senders|lastAt) -> `0|`
- `com.whatsapp` (senders|lastAt) -> `0|`

## contacts main / Promotions, paged (Row = key|name|lastText|lastAt|today)

The main list shows 8287 -> Alfalah, 8288 -> My bank (rename wins), **8290 -> Habib (its transaction source has a NULL conversation_key)**.

```sql
SELECT g.k, COALESCE(n.name, CASE WHEN g.k LIKE 'num:%' AND length(g.k) <= 10 THEN (SELECT NULLIF(trim(rtrim(t.account, '0123456789')), '') FROM items b JOIN txn_sources s ON s.item_id = b.id JOIN txns t ON t.id = s.txn_id WHERE b.sender_key = g.k ORDER BY t.at DESC, t.id DESC LIMIT 1) END, CASE WHEN (lower(trim(g.conversation)) GLOB '[0-9]* new message' OR lower(trim(g.conversation)) GLOB '[0-9]* new messages' OR lower(trim(g.conversation)) IN ('new message', 'new messages')) THEN NULL ELSE g.conversation END, CASE WHEN lower(g.sender) = 'you' THEN NULL ELSE CASE WHEN (lower(trim(g.sender)) GLOB '[0-9]* new message' OR lower(trim(g.sender)) GLOB '[0-9]* new messages' OR lower(trim(g.sender)) IN ('new message', 'new messages')) THEN NULL ELSE g.sender END END, g.app_label, g.k), g.text, g.last, g.today FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, i.conversation AS conversation, i.sender AS sender, i.app_label AS app_label, i.text AS text, MAX(i.posted_at) AS last, SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END) AS today FROM items i WHERE i.pkg = ? AND (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL AND (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) GROUP BY k) g LEFT JOIN sender_names n ON n.sender_key = g.k ORDER BY g.last DESC, g.k DESC LIMIT ?

SELECT g.k, COALESCE(n.name, CASE WHEN g.k LIKE 'num:%' AND length(g.k) <= 10 THEN (SELECT NULLIF(trim(rtrim(t.account, '0123456789')), '') FROM items b JOIN txn_sources s ON s.item_id = b.id JOIN txns t ON t.id = s.txn_id WHERE b.sender_key = g.k ORDER BY t.at DESC, t.id DESC LIMIT 1) END, CASE WHEN (lower(trim(g.conversation)) GLOB '[0-9]* new message' OR lower(trim(g.conversation)) GLOB '[0-9]* new messages' OR lower(trim(g.conversation)) IN ('new message', 'new messages')) THEN NULL ELSE g.conversation END, CASE WHEN lower(g.sender) = 'you' THEN NULL ELSE CASE WHEN (lower(trim(g.sender)) GLOB '[0-9]* new message' OR lower(trim(g.sender)) GLOB '[0-9]* new messages' OR lower(trim(g.sender)) IN ('new message', 'new messages')) THEN NULL ELSE g.sender END END, g.app_label, g.k), g.text, g.last, g.today FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, i.conversation AS conversation, i.sender AS sender, i.app_label AS app_label, i.text AS text, MAX(i.posted_at) AS last, SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END) AS today FROM items i WHERE i.pkg = ? AND (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL AND (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) GROUP BY k) g LEFT JOIN sender_names n ON n.sender_key = g.k WHERE (g.last < ? OR (g.last = ? AND g.k < ?)) ORDER BY g.last DESC, g.k DESC LIMIT ?

SELECT g.k, COALESCE(n.name, CASE WHEN g.k LIKE 'num:%' AND length(g.k) <= 10 THEN (SELECT NULLIF(trim(rtrim(t.account, '0123456789')), '') FROM items b JOIN txn_sources s ON s.item_id = b.id JOIN txns t ON t.id = s.txn_id WHERE b.sender_key = g.k ORDER BY t.at DESC, t.id DESC LIMIT 1) END, CASE WHEN (lower(trim(g.conversation)) GLOB '[0-9]* new message' OR lower(trim(g.conversation)) GLOB '[0-9]* new messages' OR lower(trim(g.conversation)) IN ('new message', 'new messages')) THEN NULL ELSE g.conversation END, CASE WHEN lower(g.sender) = 'you' THEN NULL ELSE CASE WHEN (lower(trim(g.sender)) GLOB '[0-9]* new message' OR lower(trim(g.sender)) GLOB '[0-9]* new messages' OR lower(trim(g.sender)) IN ('new message', 'new messages')) THEN NULL ELSE g.sender END END, g.app_label, g.k), g.text, g.last, g.today FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, i.conversation AS conversation, i.sender AS sender, i.app_label AS app_label, i.text AS text, MAX(i.posted_at) AS last, SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END) AS today FROM items i WHERE i.pkg = ? AND (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL AND NOT (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) GROUP BY k) g LEFT JOIN sender_names n ON n.sender_key = g.k ORDER BY g.last DESC, g.k DESC LIMIT ?

SELECT g.k, COALESCE(n.name, CASE WHEN g.k LIKE 'num:%' AND length(g.k) <= 10 THEN (SELECT NULLIF(trim(rtrim(t.account, '0123456789')), '') FROM items b JOIN txn_sources s ON s.item_id = b.id JOIN txns t ON t.id = s.txn_id WHERE b.sender_key = g.k ORDER BY t.at DESC, t.id DESC LIMIT 1) END, CASE WHEN (lower(trim(g.conversation)) GLOB '[0-9]* new message' OR lower(trim(g.conversation)) GLOB '[0-9]* new messages' OR lower(trim(g.conversation)) IN ('new message', 'new messages')) THEN NULL ELSE g.conversation END, CASE WHEN lower(g.sender) = 'you' THEN NULL ELSE CASE WHEN (lower(trim(g.sender)) GLOB '[0-9]* new message' OR lower(trim(g.sender)) GLOB '[0-9]* new messages' OR lower(trim(g.sender)) IN ('new message', 'new messages')) THEN NULL ELSE g.sender END END, g.app_label, g.k), g.text, g.last, g.today FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, i.conversation AS conversation, i.sender AS sender, i.app_label AS app_label, i.text AS text, MAX(i.posted_at) AS last, SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END) AS today FROM items i WHERE i.pkg = ? AND (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL AND NOT (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) GROUP BY k) g LEFT JOIN sender_names n ON n.sender_key = g.k WHERE (g.last < ? OR (g.last = ? AND g.k < ?)) ORDER BY g.last DESC, g.k DESC LIMIT ?
```

Unpaged main:
```
num:6007|6007|plain 6007|999000070|1
num:6006|6006|plain 6006|999000070|1
num:6005|6005|plain 6005|999000070|1
num:6002|6002|p2 1|999000051|2
num:7000|7000|no ai|999000030|1
num:9999|9999|half 3|999000023|4
num:8290|Habib|habib notif|999000011|1
num:8288|My bank|alfalah two|999000010|1
num:8287|Alfalah|bank 5|999000005|5
```
Unpaged Promotions:
```
num:6003|6003|ordinary|999000060|1
num:6008|6008|promo 8|999000042|1
num:6004|6004|promo 4|999000042|1
num:6001|6001|sale 2|999000042|3
```

Paged main limit 2: pages [['num:6007', 'num:6006'], ['num:6005', 'num:6002'], ['num:7000', 'num:9999'], ['num:8290', 'num:8288'], ['num:8287']]; equals unpaged: **True**

Paged Promotions limit 2: pages [['num:6003', 'num:6008'], ['num:6004', 'num:6001'], []]; equals unpaged: **True**

Paged main limit 3: pages [['num:6007', 'num:6006', 'num:6005'], ['num:6002', 'num:7000', 'num:9999'], ['num:8290', 'num:8288', 'num:8287'], []]; equals unpaged: **True**

Paged Promotions limit 1: pages [['num:6003'], ['num:6008'], ['num:6004'], ['num:6001'], []]; equals unpaged: **True**

Main and Promotions disjoint: **True**; num:5555 in neither: **True**; num:8290 named Habib: **True**; 8287 named Alfalah: **True**; 8288 named My bank: **True**

## WhatsApp shares the num: keys

WhatsApp main list:
```
num:6003|6003|wa from override number|999000201|1
num:6001|6001|wa from unsaved number|999000200|1
com.whatsapp:sunflower|Sunflower|urgent|999000130|1
num:6008|6008|wa older than promo sms|999000036|1
com.whatsapp:old|Old|old urgent|300000000|0
```
WhatsApp Promotions (must be empty):
```

```

num:6001, num:6003 and num:6008 in WhatsApp main list: **True**; WhatsApp Promotions empty: **True**

## stats

```sql
SELECT i.pkg, COALESCE(a.label, MAX(i.app_label)), MAX(i.posted_at), SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END), MAX(i.conversation_key IS NOT NULL) FROM items i LEFT JOIN apps a ON a.pkg = i.pkg WHERE (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) GROUP BY i.pkg ORDER BY MAX(i.posted_at) DESC

SELECT i.pkg, COALESCE(a.label, MAX(i.app_label)), MAX(i.posted_at), SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END), MAX(i.conversation_key IS NOT NULL) FROM items i LEFT JOIN apps a ON a.pkg = i.pkg WHERE (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) GROUP BY i.pkg ORDER BY MAX(i.posted_at) DESC
```

### stats_all


Parameters: `[990000000, 1000000000]`

```
com.whatsapp|WhatsApp|999000201|4|1
com.linkedin.android|LinkedIn|999000121|2|1
com.b.cal|Calendar|999000110|1|0
com.a.cal|Calendar|999000100|1|0
com.daraz|Daraz|999000097|3|0
com.android.mms|Messages2|999000090|1|1
com.google.android.apps.messaging|Messages|999000070|23|1
com.google.android.gm|Gmail|999000004|1|1
```

### stats_nopromo (Inbox input)


Parameters: `[990000000, 1000000000]`

```
com.whatsapp|WhatsApp|999000201|4|1
com.linkedin.android|LinkedIn|999000121|2|1
com.b.cal|Calendar|999000110|1|0
com.a.cal|Calendar|999000100|1|0
com.daraz|Daraz|999000097|3|0
com.google.android.apps.messaging|Messages|999000070|17|1
com.google.android.gm|Gmail|999000004|1|1
```

## home conversations (M1)

Row = key|pkg|app_label|name|lastText|lastAt|today. The j subquery now picks the newest NON-promotional item of the key, so WhatsApp's num:6008 chat (item 103, T+36) stays although a newer promotional SMS (T+42) exists on the same number. Placeholders: 4 (startOfDay, now x3), unchanged.

```sql
SELECT i.conversation_key, i.pkg, i.app_label, COALESCE(n.name, CASE WHEN i.conversation_key LIKE 'num:%' AND length(i.conversation_key) <= 10 THEN (SELECT NULLIF(trim(rtrim(t.account, '0123456789')), '') FROM items b JOIN txn_sources s ON s.item_id = b.id JOIN txns t ON t.id = s.txn_id WHERE b.sender_key = i.conversation_key ORDER BY t.at DESC, t.id DESC LIMIT 1) END, CASE WHEN (lower(trim(i.conversation)) GLOB '[0-9]* new message' OR lower(trim(i.conversation)) GLOB '[0-9]* new messages' OR lower(trim(i.conversation)) IN ('new message', 'new messages')) THEN NULL ELSE i.conversation END, CASE WHEN lower(i.sender) = 'you' THEN NULL ELSE CASE WHEN (lower(trim(i.sender)) GLOB '[0-9]* new message' OR lower(trim(i.sender)) GLOB '[0-9]* new messages' OR lower(trim(i.sender)) IN ('new message', 'new messages')) THEN NULL ELSE i.sender END END, i.app_label, i.conversation_key), i.text, i.posted_at, (SELECT COUNT(*) FROM items t WHERE t.conversation_key = i.conversation_key AND t.posted_at >= ? AND (t.otp_expires_at IS NULL OR t.otp_expires_at > ?)) FROM items i LEFT JOIN sender_names n ON n.sender_key = i.conversation_key WHERE i.conversation_key IS NOT NULL AND (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) AND i.id = (SELECT j.id FROM items j WHERE j.conversation_key = i.conversation_key AND (j.otp_expires_at IS NULL OR j.otp_expires_at > ?) AND (NOT (j.sms_hash IS NOT NULL OR j.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(j.conversation_key, j.sender_key) IS NULL OR COALESCE(j.conversation_key, j.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) ORDER BY j.posted_at DESC, j.id DESC LIMIT 1) ORDER BY i.posted_at DESC, i.id DESC LIMIT 5
```

### home_conversations (LIMIT 5)


Parameters: `[990000000, 1000000000, 1000000000, 1000000000]`

```
num:6003|com.whatsapp|WhatsApp|6003|wa from override number|999000201|2
num:6001|com.whatsapp|WhatsApp|6001|wa from unsaved number|999000200|4
com.whatsapp:sunflower|com.whatsapp|WhatsApp|Sunflower|urgent|999000130|1
com.linkedin.android:2 new messages|com.linkedin.android|LinkedIn|Ahmed|yo|999000121|1
com.linkedin.android:1 new message|com.linkedin.android|LinkedIn|LinkedIn|hi|999000120|1
```

Same statement with LIMIT 50 (to see every row):
```
num:6003|com.whatsapp|WhatsApp|6003|wa from override number|999000201|2
num:6001|com.whatsapp|WhatsApp|6001|wa from unsaved number|999000200|4
com.whatsapp:sunflower|com.whatsapp|WhatsApp|Sunflower|urgent|999000130|1
com.linkedin.android:2 new messages|com.linkedin.android|LinkedIn|Ahmed|yo|999000121|1
com.linkedin.android:1 new message|com.linkedin.android|LinkedIn|LinkedIn|hi|999000120|1
num:6007|com.google.android.apps.messaging|Messages|6007|plain 6007|999000070|1
num:6006|com.google.android.apps.messaging|Messages|6006|plain 6006|999000070|1
num:6005|com.google.android.apps.messaging|Messages|6005|plain 6005|999000070|1
num:6002|com.google.android.apps.messaging|Messages|6002|p2 1|999000051|2
num:6008|com.whatsapp|WhatsApp|6008|wa older than promo sms|999000036|2
num:7000|com.google.android.apps.messaging|Messages|7000|no ai|999000030|1
num:9999|com.google.android.apps.messaging|Messages|9999|half 3|999000023|4
num:8288|com.google.android.apps.messaging|Messages|My bank|alfalah two|999000010|1
num:8287|com.google.android.apps.messaging|Messages|Alfalah|bank 5|999000005|5
com.google.android.gm:alfalah|com.google.android.gm|Gmail|Alfalah|payment mail|999000004|1
com.whatsapp:old|com.whatsapp|WhatsApp|Old|old urgent|300000000|0
```

num:6008 row is the WhatsApp item: **True**; no SMS row for num:6001/6004/6008: **True**; LinkedIn `1 new message` named LinkedIn: **True**

## home important

```sql
SELECT i.id, i.pkg, i.app_label, i.sender, i.sender_key, COALESCE(n.name, i.sender), i.conversation, i.conversation_key, i.title, i.text, i.posted_at, i.deleted_by_sender, i.email_text, r.kind, r.summary, r.importance, r.tags, (SELECT COUNT(*) FROM media m WHERE m.item_id = i.id) FROM items i LEFT JOIN sender_names n ON n.sender_key = i.sender_key LEFT JOIN ai_results r ON r.item_id = i.id WHERE r.importance = 'high' AND i.posted_at >= ? AND (i.otp_expires_at IS NULL OR i.otp_expires_at > ?) AND NOT EXISTS (SELECT 1 FROM txn_sources ts WHERE ts.item_id = i.id) AND (NOT (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) OR COALESCE(i.conversation_key, i.sender_key) IS NULL OR COALESCE(i.conversation_key, i.sender_key) NOT IN (SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id WHERE (i.sms_hash IS NOT NULL OR i.pkg IN ('com.google.android.apps.messaging','com.android.mms','com.samsung.android.messaging')) AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1)) ORDER BY i.posted_at DESC, i.id DESC LIMIT 5
```

### home_important (expected only id 32)


Parameters: `[395200000, 1000000000]`

```
33|com.whatsapp|WhatsApp|Sunflower|com.whatsapp:sunflower|Sunflower|Sunflower|com.whatsapp:sunflower||urgent|999000130|0||message|x|high||0
```

## hasItems

```sql
SELECT EXISTS(SELECT 1 FROM items i WHERE (i.otp_expires_at IS NULL OR i.otp_expires_at > ?))
```

- fixtures `1`; empty db `0`

## bank(k) (M2): WHERE b.sender_key = k, served by items_sender

Plan on the 60k-item scratch db (with items_sender):
```
QUERY PLAN
|--SEARCH b USING COVERING INDEX items_sender (sender_key=?)
|--SEARCH s USING INDEX sqlite_autoindex_txn_sources_1 (item_id=?)
|--SEARCH t USING INTEGER PRIMARY KEY (rowid=?)
`--USE TEMP B-TREE FOR ORDER BY
```
Plan on the fixture db:
```
QUERY PLAN
|--SEARCH b USING COVERING INDEX items_sender (sender_key=?)
|--SEARCH s USING INDEX sqlite_autoindex_txn_sources_1 (item_id=?)
|--SEARCH t USING INTEGER PRIMARY KEY (rowid=?)
`--USE TEMP B-TREE FOR ORDER BY
```

## Timings on a 60k-item scratch db (20k SMS from 2000 senders, 10k from 20 short codes each with a txn source, 30k WhatsApp; 10k txns; best of 3, sqlite3 CLI)

- contacts(main, SMS app, limit 50), with items_sender (this change): 29 ms
- contacts(main, SMS app, limit 50), without items_sender (sender_key scan): 24 ms
- contacts(main, SMS app, limit 50), F2 variant conversation_key AND sender_key (no new index): 35 ms
- home conversations (limit 5), with items_sender (this change): 76 ms
- home conversations (limit 5), without items_sender: 75 ms

- bank lookup for a short code with no transaction (worst case), with items_sender: 0.0 ms; without: 2.0 ms
- contacts(main, SMS app, limit 50) with that extra no-txn short code, with items_sender: 34 ms; without: 29 ms

The fixture is small, so the planner is fast with or without the index here; the index keeps the bank lookup bounded by the sender's own items regardless of how many transactions exist.

## Owner override and later AI results (copy)

```sql
INSERT INTO sender_promo(sender_key, promo) VALUES (?, ?) ON CONFLICT(sender_key) DO UPDATE SET promo = excluded.promo
```

- start: num:6001,num:6003,num:6004,num:6008
- Move to Promotions on num:8287: num:6001,num:6003,num:6004,num:6008,num:8287
- Keep in my list on num:8287: num:6001,num:6003,num:6004,num:6008
- Keep in my list on num:6001, then a new promotional item arrives: num:6003,num:6004,num:6008

## list filter apps

- IN (com.a.cal, com.b.cal) -> `29|com.a.cal ; 30|com.b.cal`; empty (`0 = 1`) -> `(no rows)`

## Parties

```sql
SELECT CASE WHEN own = 1 THEN NULL ELSE COALESCE(label, counterparty, '') END, own, currency, SUM(CASE direction WHEN 'IN' THEN amount_minor ELSE 0 END), SUM(CASE direction WHEN 'OUT' THEN amount_minor ELSE 0 END), COUNT(*), MAX(at) FROM txns WHERE at >= ? AND at < ? GROUP BY own, CASE WHEN own = 1 THEN '' ELSE lower(COALESCE(label, counterparty, '')) END, currency ORDER BY SUM(amount_minor) DESC, 1
```

### parties


Parameters: `[998990000, 999000001]`

```
Eman Iftikhar Baf|0|PKR|0|3000|2|998999000
Zed Shop|0|PKR|500|0|1|998996000
|1|PKR|0|400|1|998997000
|0|PKR|300|0|1|998998000
```

- party `Eman Iftikhar Baf`: totals `PKR|0|3000|2`; txn ids `11,10`
- party `EMAN IFTIKHAR BAF`: totals `PKR|0|3000|2`; txn ids `11,10`
- party `(blank = Unknown)`: totals `PKR|300|0|1`; txn ids `12`

## Result checks

- paging checks all true: **True**