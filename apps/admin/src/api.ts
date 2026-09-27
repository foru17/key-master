import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10000, refetchOnWindowFocus: false } },
});
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401 && path.startsWith("admin/"))
    window.dispatchEvent(new Event("km:unauthorized"));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}
export function useData<T>(path: string) {
  return useQuery({ queryKey: [path], queryFn: () => api<T>(`admin/${path}`) });
}
export function useAction<T = unknown>(
  path: string,
  method = "POST",
  onSuccess?: (data: T) => void,
) {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (body: unknown) => {
      const result = await api<T>(`admin/${path}`, method, body);
      onSuccess?.(result);
      return undefined;
    },
    onMutate: async () => {
      const [collection, id] = path.split("/");
      if (method !== "DELETE" || !id) return undefined;
      await client.cancelQueries({ queryKey: [collection] });
      const previous = client.getQueryData([collection]);
      if (Array.isArray(previous))
        client.setQueryData(
          [collection],
          previous.map((item) => (item.id === id ? { ...item, revokedAt: Date.now() } : item)),
        );
      return { previous, collection };
    },
    onError: (_error, _body, context) => {
      if (context) client.setQueryData([context.collection], context.previous);
    },
    onSettled: () => {
      void client.invalidateQueries();
    },
  });
}
