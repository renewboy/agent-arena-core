# SQLite storage package

`@agent-arena/storage-sqlite` 是 Core store ports 的参考实现，持久化 Match setup/outcome、确定性事件、
Session binding、delivery snapshot 与 trajectory entries。调用方提供 setup、outcome、delivery 和
trajectory codecs，所有读取均重新解析边界数据。

迁移记录位于 module-owned `arena_schema_migrations`，因此不占用宿主应用的 `PRAGMA user_version`。
事件在事务内保持连续 sequence，Match 删除通过外键级联。该实现使用独立 SQLite 边界，不规定产品
数据库必须采用相同表结构。
