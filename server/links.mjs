// Facebook comment link: ?comment_id=…, a reply adds &reply_comment_id=…; a bad or missing permalink gives null, never an error
export function commentUrl(permalink,fbCommentId,parentFbId){
  if(!permalink)return null;
  try{
    const u=new URL(permalink);
    if(parentFbId){u.searchParams.set('comment_id',parentFbId);u.searchParams.set('reply_comment_id',fbCommentId);}else u.searchParams.set('comment_id',fbCommentId);
    return u.href;
  }catch{return null;}
}
