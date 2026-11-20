import {AppError,nowIso} from './util.mjs';
export const TEMPLATES={
  knowledge:`## Sản phẩm
- (điền sản phẩm, mỗi dòng một sản phẩm)

## Giá
- (điền giá từng sản phẩm; chỉ những giá ghi ở đây mới được báo)

## Giao hàng
- (điền cách giao, phí và thời gian giao)

## Bảo hành
- (điền chính sách bảo hành, đổi trả)

## Liên hệ được công khai
- (điền số điện thoại, Zalo, website được phép nêu trên nhóm)

## Tên shop / công ty
- (điền tên shop hoặc công ty)
`,
  persona:`## Xưng hô
- (điền cách xưng hô, ví dụ: gọi khách là anh/chị, xưng là shop)

## Giọng điệu
- (điền giọng điệu: thân thiện, lịch sự, ngắn gọn...)

## Độ dài
- (điền độ dài câu trả lời, ví dụ: 1 đến 3 câu)

## Emoji
- (điền có dùng emoji không, dùng tối đa mấy cái)

## Không bao giờ nói
- (điền những điều tuyệt đối không nói: hứa hẹn quá mức, so sánh đối thủ...)
`,
};
const KINDS=['knowledge','persona'];
const kindOf=kind=>{if(!KINDS.includes(kind))throw new AppError('INVALID_SETTING','Loại kiến thức phải là knowledge hoặc persona.');return kind;};
const latest=(db,kind)=>db.first('SELECT id,text FROM kb_versions WHERE kind=? ORDER BY id DESC LIMIT 1',[kind]);
export async function saveKb(db,kind,text){
  kindOf(kind);if(typeof text!=='string')throw new AppError('INVALID_SETTING','Nội dung phải là chữ.');
  await db.run('INSERT INTO kb_versions(kind,text,created_at) VALUES(?,?,?)',[kind,text,nowIso()]);
  return (await latest(db,kind)).id;
}
export async function getKb(db){
  const out={};
  for(const kind of KINDS){
    let row=await latest(db,kind);
    if(!row){await saveKb(db,kind,TEMPLATES[kind]);row=await latest(db,kind);}
    out[kind]=row.text;out[kind+'Version']=row.id;
  }
  return {knowledge:out.knowledge,persona:out.persona,knowledgeVersion:out.knowledgeVersion,personaVersion:out.personaVersion};
}
export async function listKbVersions(db,kind,limit=20){
  return db.all('SELECT id,kind,text,created_at FROM kb_versions WHERE kind=? ORDER BY id DESC LIMIT ?',[kindOf(kind),limit]);
}
