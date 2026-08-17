#pragma once
// Batched topology-aware reaction effects. Rules describe intent; this
// transaction owns component/body preservation, splitting, spawning, and wakes.

struct Engine;

class ReactionTransaction {
 public:
  ReactionTransaction(Engine& engine, Layer& layer);

  void queue(const GeneratedReactionEffect& effect,
             const ReactionSubject& source,
             const ReactionSubject& target,
             double normalX = 0, double normalY = 0);
  bool commit();
  bool empty() const { return commands.empty(); }

 private:
  struct Command {
    GeneratedReactionEffect effect;
    ReactionSubject subject;
    double normalX = 0;
    double normalY = 0;
  };

  Engine& E;
  Layer& targetLayer;
  std::vector<Command> commands;
};
