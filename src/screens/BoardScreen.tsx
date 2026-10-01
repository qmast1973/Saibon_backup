import { useEffect, useState, type FormEvent } from 'react';
import { MessageSquare, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import type { BoardPost } from '../types';
import * as board from '../data/board';
import { isAdmin } from '../domain/access';
import { useApp } from '../state/AppContext';
import { Button, ConfirmDialog, EmptyState, Field, Input, Modal, Screen, Textarea } from '../components/ui';

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** 공지 · 요청 게시판 (전 회원 공용). 글/댓글은 본인 또는 관리자가 수정 · 삭제. */
export function BoardScreen({ onClose }: { onClose: () => void }) {
  const { user, notify } = useApp();
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [editor, setEditor] = useState<{ post?: BoardPost } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; run: () => Promise<void> } | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  useEffect(() => board.subscribeBoard(setPosts), []);
  const author = { authorName: user!.name, authorUsername: user!.username };
  const canManage = (username: string) => isAdmin(user) || username === user!.username;
  const run = (p: Promise<void>) => p.catch(() => notify('처리하지 못했습니다. 네트워크를 확인해주세요.', 'error'));

  const addComment = (postId: string) => {
    const content = comments[postId]?.trim();
    if (!content) return;
    run(board.addComment(postId, { content, ...author }).then(() => setComments(prev => ({ ...prev, [postId]: '' }))));
  };

  return (
    <Screen
      title={<><MessageSquare className="h-5 w-5 text-amber-400" />게시판</>}
      subtitle="공지와 요청 사항을 함께 봅니다."
      onClose={onClose}
      width="max-w-3xl"
      z="z-[160]"
      actions={<Button tone="warning" onClick={() => setEditor({})}><Plus className="h-4 w-4" />글쓰기</Button>}
    >
      <div className="space-y-3">
        {posts.length === 0 && <EmptyState icon={<MessageSquare className="h-8 w-8" />}>아직 글이 없습니다.</EmptyState>}
        {posts.map(p => (
          <article key={p.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h2 className="font-bold text-gray-100">{p.title}</h2>
                <p className="text-[11px] text-gray-500">{p.authorName} · {formatTime(p.createdAt)}</p>
              </div>
              {canManage(p.authorUsername) && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => setEditor({ post: p })} className="p-1.5 text-gray-400 hover:text-indigo-300" aria-label="수정"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setConfirm({ title: '글 삭제', run: () => board.deletePost(p.id) })} className="p-1.5 text-gray-400 hover:text-rose-400" aria-label="삭제"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-gray-300">{p.content}</p>

            <div className="mt-3 space-y-1.5 border-t border-gray-800 pt-3">
              {p.comments.map(c => (
                <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg bg-gray-950 px-2.5 py-1.5 text-xs">
                  <p className="text-gray-300"><b className="text-gray-100">{c.authorName}</b> {c.content} <span className="text-gray-600">{formatTime(c.createdAt)}</span></p>
                  {canManage(c.authorUsername) && (
                    <button type="button" onClick={() => setConfirm({ title: '댓글 삭제', run: () => board.deleteComment(p.id, c.id) })} className="text-gray-500 hover:text-rose-400" aria-label="댓글 삭제"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              <div className="flex gap-1.5">
                <Input
                  value={comments[p.id] || ''}
                  onChange={e => setComments(prev => ({ ...prev, [p.id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && addComment(p.id)}
                  placeholder="댓글 입력"
                  className="py-1.5 text-xs"
                />
                <Button size="sm" tone="primary" onClick={() => addComment(p.id)} aria-label="댓글 등록"><Send className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {editor && <PostEditor post={editor.post} onClose={() => setEditor(null)} author={author} />}
      {confirm && (
        <ConfirmDialog title={confirm.title} message="삭제하면 되돌릴 수 없습니다." confirmLabel="삭제"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { run(confirm.run()); setConfirm(null); }}
        />
      )}
    </Screen>
  );
}

function PostEditor({ post, author, onClose }: { post?: BoardPost; author: { authorName: string; authorUsername: string }; onClose: () => void }) {
  const { notify } = useApp();
  const [title, setTitle] = useState(post?.title || '');
  const [content, setContent] = useState(post?.content || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return notify('제목과 내용을 입력해주세요.', 'error');
    setSaving(true);
    try {
      if (post) await board.updatePost(post.id, { title: title.trim(), content: content.trim() });
      else await board.addPost({ title: title.trim(), content: content.trim(), ...author });
      onClose();
    } catch {
      notify('저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={post ? '글 수정' : '새 글'} onClose={onClose} z="z-[300]"
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" type="submit" form="post-form" disabled={saving}>{saving ? '저장 중...' : '저장'}</Button></>}
    >
      <form id="post-form" onSubmit={submit} className="space-y-3">
        <Field label="제목"><Input value={title} onChange={e => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="내용"><Textarea rows={8} value={content} onChange={e => setContent(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
