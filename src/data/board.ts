import { onValue, push, ref, remove, set, update } from 'firebase/database';
import type { BoardComment, BoardPost } from '../types';
import { rtdb } from './firebase';

type Author = { authorName: string; authorUsername: string };

export function subscribeBoard(onChange: (posts: BoardPost[]) => void) {
  return onValue(ref(rtdb, 'board'), snap => {
    const posts: BoardPost[] = [];
    snap.forEach(child => {
      const v = child.val() || {};
      const comments: BoardComment[] = Object.entries((v.comments || {}) as Record<string, Omit<BoardComment, 'id'>>)
        .map(([id, c]) => ({ ...c, id }))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      posts.push({
        id: child.key!,
        title: String(v.title || ''),
        content: String(v.content || ''),
        authorName: String(v.authorName || ''),
        authorUsername: String(v.authorUsername || ''),
        createdAt: String(v.createdAt || ''),
        comments,
      });
    });
    onChange(posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
}

export async function addPost(post: { title: string; content: string } & Author) {
  await set(push(ref(rtdb, 'board')), { ...post, createdAt: new Date().toISOString() });
}

export async function updatePost(id: string, data: { title: string; content: string }) {
  await update(ref(rtdb, `board/${id}`), data);
}

export async function deletePost(id: string) {
  await remove(ref(rtdb, `board/${id}`));
}

export async function addComment(postId: string, comment: { content: string } & Author) {
  await set(push(ref(rtdb, `board/${postId}/comments`)), { ...comment, createdAt: new Date().toISOString() });
}

export async function deleteComment(postId: string, commentId: string) {
  await remove(ref(rtdb, `board/${postId}/comments/${commentId}`));
}

export async function deleteAllPosts() {
  await set(ref(rtdb, 'board'), null);
}
