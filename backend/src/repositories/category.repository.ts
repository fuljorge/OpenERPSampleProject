import { ObjectId, type Collection, type Db } from "mongodb";

export interface CategoryDocument {
  _id: ObjectId;
  code: string;
  name: string;
  department: string;
  active: boolean;
  createdAt: Date;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  department: string;
  active: boolean;
  createdAt: Date;
}

export interface CreateCategoryInput {
  code: string;
  name: string;
  department: string;
}

export interface UpdateCategoryProfileInput {
  name?: string;
  department?: string;
}

export interface ListCategoriesOptions {
  active?: boolean;
}

function collection(db: Db): Collection<CategoryDocument> {
  return db.collection<CategoryDocument>("categories");
}

function toCategory(doc: CategoryDocument): Category {
  return {
    id: doc._id.toHexString(),
    code: doc.code,
    name: doc.name,
    department: doc.department,
    active: doc.active,
    createdAt: doc.createdAt,
  };
}

export const categoryRepository = {
  async findByCode(db: Db, code: string): Promise<Category | null> {
    const doc = await collection(db).findOne({ code });
    return doc ? toCategory(doc) : null;
  },

  async findById(db: Db, id: string): Promise<Category | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await collection(db).findOne({ _id: new ObjectId(id) });
    return doc ? toCategory(doc) : null;
  },

  async list(db: Db, options: ListCategoriesOptions = {}): Promise<Category[]> {
    const filter = options.active !== undefined ? { active: options.active } : {};
    const docs = await collection(db).find(filter).sort({ code: 1 }).toArray();
    return docs.map(toCategory);
  },

  async create(db: Db, input: CreateCategoryInput): Promise<Category> {
    const doc: CategoryDocument = {
      _id: new ObjectId(),
      code: input.code,
      name: input.name,
      department: input.department,
      active: true,
      createdAt: new Date(),
    };
    await collection(db).insertOne(doc);
    return toCategory(doc);
  },

  async updateProfile(db: Db, id: string, input: UpdateCategoryProfileInput): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const patch: Partial<Pick<CategoryDocument, "name" | "department">> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.department !== undefined) patch.department = input.department;

    await collection(db).updateOne({ _id: new ObjectId(id) }, { $set: patch });
  },

  async updateStatus(db: Db, id: string, active: boolean): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await collection(db).updateOne({ _id: new ObjectId(id) }, { $set: { active } });
  },
};
