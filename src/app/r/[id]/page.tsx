import { RoomView } from './room'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RoomView id={id} />
}
