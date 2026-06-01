export type ArtistPick = {
  rank: number;
  name: string;
  imageUrl: string | null;
};

export type AlbumPick = {
  rank: number;
  album: string;
  artist: string;
  imageUrl: string | null;
};

export type Submission = {
  name: string;
  createdAt: string;
  updatedAt: string;
  artists: ArtistPick[];
  albums: AlbumPick[];
};

export type SubmissionSummary = {
  name: string;
  updatedAt: string;
};

export type AggregateRow = {
  rank: number;
  displayName: string;
  artist?: string;
  imageUrl: string | null;
  score: number;
  votes: number;
};

export type AggregateResponse = {
  artists: AggregateRow[];
  albums: AggregateRow[];
};

export type SubmissionInput = {
  name: string;
  editToken?: string;
  artists: string[];
  albums: { album: string; artist: string }[];
};
